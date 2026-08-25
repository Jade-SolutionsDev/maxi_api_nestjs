import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, In, Repository } from 'typeorm';
import { Client } from '../clients/entities/client.entity';
import {
  PaginatedResponse,
  buildPaginatedResponse,
} from '../common/dto/pagination.dto';
import { NomenclatorsService } from '../nomenclators/nomenclators.service';
import { User } from '../users/entities/user.entity';
import { ContactMailService } from './contact-mail.service';
import {
  ContactMessageResponseDto,
  ContactMessagesQueryDto,
  ContactReplyResponseDto,
  CreateContactMessageDto,
} from './dto/contact-message.dto';
import { CreateContactReplyDto } from './dto/contact-reply.dto';
import {
  CreateContactTemplateDto,
  UpdateContactTemplateDto,
} from './dto/contact-template.dto';
import {
  ContactMessage,
  ContactMessageStatus,
} from './entities/contact-message.entity';
import { ContactReplyTemplate } from './entities/contact-reply-template.entity';
import {
  ContactReply,
  ContactReplyChannel,
} from './entities/contact-reply.entity';

export const CONTACT_MOTIVE_CATEGORY = 'contact-motive';

/**
 * Customer support inquiries. Submissions are public (anonymous or bearer-
 * identified clients); the inbox, reply log and templates are backoffice
 * surfaces gated by the 'contact' permission module at the controllers.
 */
@Injectable()
export class ContactService {
  constructor(
    @InjectRepository(ContactMessage)
    private readonly messageRepository: Repository<ContactMessage>,
    @InjectRepository(ContactReply)
    private readonly replyRepository: Repository<ContactReply>,
    @InjectRepository(ContactReplyTemplate)
    private readonly templateRepository: Repository<ContactReplyTemplate>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly nomenclatorsService: NomenclatorsService,
    private readonly contactMailService: ContactMailService,
  ) {}

  // ---------------- Storefront submission ----------------

  /**
   * Persist a submission. `client` present = signed-in sender: identity is
   * snapshotted from the Client row and any body identity is ignored.
   * Anonymous senders must bring name + lastName and email OR phone.
   * Returns null for honeypot hits — the controller still answers success so
   * bots learn nothing.
   */
  async submitMessage(
    dto: CreateContactMessageDto,
    client: Client | null,
  ): Promise<ContactMessage | null> {
    if (dto.website && dto.website.trim() !== '') {
      return null;
    }

    const motive = await this.nomenclatorsService.findActiveOption(
      CONTACT_MOTIVE_CATEGORY,
      dto.motiveId,
    );
    if (!motive) {
      throw new BadRequestException('Unknown contact motive');
    }

    const identity = client
      ? {
          clientId: client.id,
          name: client.firstName,
          lastName: client.lastName,
          email: client.email,
          phone: client.phone,
        }
      : {
          clientId: null,
          name: dto.name?.trim() || null,
          lastName: dto.lastName?.trim() || null,
          email: dto.email?.trim() || null,
          phone: dto.phone?.trim() || null,
        };

    if (!client) {
      if (!identity.name || !identity.lastName) {
        throw new UnprocessableEntityException(
          'Name and last name are required',
        );
      }
      if (!identity.email && !identity.phone) {
        throw new UnprocessableEntityException(
          'An email or a phone number is required',
        );
      }
    }

    const message = this.messageRepository.create({
      motiveId: motive.id,
      ...identity,
      message: dto.message.trim(),
      status: ContactMessageStatus.NUEVO,
    });
    return this.messageRepository.save(message);
  }

  // ---------------- Backoffice inbox ----------------

  async listMessages(
    query: ContactMessagesQueryDto,
  ): Promise<PaginatedResponse<ContactMessageResponseDto>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const qb = this.messageRepository
      .createQueryBuilder('m')
      .orderBy('m.createdAt', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);

    if (query.q) {
      qb.andWhere(
        new Brackets((where) => {
          where
            .where('m.name ILIKE :q', { q: `%${query.q}%` })
            .orWhere('m.lastName ILIKE :q')
            .orWhere('m.email ILIKE :q')
            .orWhere('m.phone ILIKE :q')
            .orWhere('m.message ILIKE :q');
        }),
      );
    }
    if (query.motiveId) {
      qb.andWhere('m.motiveId = :motiveId', { motiveId: query.motiveId });
    }
    if (query.status) {
      qb.andWhere('m.status = :status', { status: query.status });
    }
    if (query.createdFrom) {
      qb.andWhere('m.createdAt >= :createdFrom', {
        createdFrom: query.createdFrom,
      });
    }
    if (query.createdTo) {
      // Inclusive day bound: everything strictly before the next day.
      qb.andWhere("m.createdAt < :createdTo::date + interval '1 day'", {
        createdTo: query.createdTo,
      });
    }

    const [rows, total] = await qb.getManyAndCount();
    const labels = await this.nomenclatorsService.labelsFor(
      rows.map((row) => row.motiveId),
    );

    return buildPaginatedResponse(
      rows.map((row) =>
        ContactMessageResponseDto.fromEntity(
          row,
          labels.get(row.motiveId) ?? null,
        ),
      ),
      total,
      page,
      limit,
    );
  }

  async getMessage(id: string): Promise<ContactMessageResponseDto> {
    const message = await this.messageRepository.findOne({ where: { id } });
    if (!message) {
      throw new NotFoundException(`Contact message "${id}" not found`);
    }

    const replies = await this.replyRepository.find({
      where: { messageId: id },
      order: { createdAt: 'ASC' },
    });
    const userIds = [...new Set(replies.map((reply) => reply.userId))];
    const users = userIds.length
      ? await this.userRepository.find({ where: { id: In(userIds) } })
      : [];
    const userNames = new Map(
      users.map((user) => [
        user.id,
        [user.firstName, user.lastName].filter(Boolean).join(' ') || null,
      ]),
    );

    const labels = await this.nomenclatorsService.labelsFor([message.motiveId]);

    return ContactMessageResponseDto.fromEntity(
      message,
      labels.get(message.motiveId) ?? null,
      replies.map((reply) =>
        ContactReplyResponseDto.fromEntity(
          reply,
          userNames.get(reply.userId) ?? null,
        ),
      ),
    );
  }

  async updateStatus(
    id: string,
    status: ContactMessageStatus,
  ): Promise<ContactMessageResponseDto> {
    const message = await this.messageRepository.findOne({ where: { id } });
    if (!message) {
      throw new NotFoundException(`Contact message "${id}" not found`);
    }
    message.status = status;
    await this.messageRepository.save(message);
    return this.getMessage(id);
  }

  /**
   * Append a reply-log entry. Channel 'plataforma' actually sends the email
   * (503 until Resend is configured — nothing is logged then). Any real
   * answer channel bumps the message to 'respondido' unless it was closed;
   * internal notes never move the status.
   */
  async addReply(
    messageId: string,
    userId: string,
    dto: CreateContactReplyDto,
  ): Promise<ContactMessageResponseDto> {
    const message = await this.messageRepository.findOne({
      where: { id: messageId },
    });
    if (!message) {
      throw new NotFoundException(`Contact message "${messageId}" not found`);
    }

    if (dto.templateId) {
      const template = await this.templateRepository.findOne({
        where: { id: dto.templateId },
        withDeleted: true,
      });
      if (!template) {
        throw new BadRequestException('Unknown reply template');
      }
    }

    if (dto.channel === ContactReplyChannel.PLATAFORMA) {
      if (!message.email) {
        throw new UnprocessableEntityException(
          'The sender left no email address',
        );
      }
      if (!dto.body) {
        throw new UnprocessableEntityException(
          'A body is required to send a platform reply',
        );
      }
      await this.contactMailService.sendReply(
        message.email,
        'Respuesta a tu mensaje — Maxi',
        dto.body,
      );
    }

    await this.replyRepository.save(
      this.replyRepository.create({
        messageId,
        userId,
        channel: dto.channel,
        templateId: dto.templateId ?? null,
        body: dto.body ?? null,
      }),
    );

    if (
      dto.channel !== ContactReplyChannel.NOTA &&
      message.status !== ContactMessageStatus.CERRADO
    ) {
      message.status = ContactMessageStatus.RESPONDIDO;
      await this.messageRepository.save(message);
    }

    return this.getMessage(messageId);
  }

  get platformReplyEnabled(): boolean {
    return this.contactMailService.configured;
  }

  // ---------------- Reply templates ----------------

  async listTemplates(): Promise<ContactReplyTemplate[]> {
    return this.templateRepository.find({
      order: { sortOrder: 'ASC', title: 'ASC' },
    });
  }

  async getTemplate(id: string): Promise<ContactReplyTemplate> {
    const template = await this.templateRepository.findOne({ where: { id } });
    if (!template) {
      throw new NotFoundException(`Reply template "${id}" not found`);
    }
    return template;
  }

  async createTemplate(
    dto: CreateContactTemplateDto,
  ): Promise<ContactReplyTemplate> {
    if (dto.motiveId) {
      await this.assertMotive(dto.motiveId);
    }
    const template = this.templateRepository.create({
      title: dto.title,
      body: dto.body,
      motiveId: dto.motiveId ?? null,
      sortOrder: dto.sortOrder ?? 0,
      isActive: dto.isActive ?? true,
    });
    return this.templateRepository.save(template);
  }

  async updateTemplate(
    id: string,
    dto: UpdateContactTemplateDto,
  ): Promise<ContactReplyTemplate> {
    const template = await this.getTemplate(id);
    if (dto.motiveId !== undefined && dto.motiveId !== null) {
      await this.assertMotive(dto.motiveId);
    }
    if (dto.title !== undefined) {
      template.title = dto.title;
    }
    if (dto.body !== undefined) {
      template.body = dto.body;
    }
    if (dto.motiveId !== undefined) {
      template.motiveId = dto.motiveId;
    }
    if (dto.sortOrder !== undefined) {
      template.sortOrder = dto.sortOrder;
    }
    if (dto.isActive !== undefined) {
      template.isActive = dto.isActive;
    }
    return this.templateRepository.save(template);
  }

  async removeTemplate(id: string): Promise<void> {
    await this.getTemplate(id);
    await this.templateRepository.softDelete(id);
  }

  private async assertMotive(motiveId: string): Promise<void> {
    const motive = await this.nomenclatorsService.findActiveOption(
      CONTACT_MOTIVE_CATEGORY,
      motiveId,
    );
    if (!motive) {
      throw new BadRequestException('Unknown contact motive');
    }
  }
}
