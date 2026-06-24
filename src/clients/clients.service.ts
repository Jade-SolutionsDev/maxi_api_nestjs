import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CreateClientDto } from './dto/create-client.dto';
import { UpdateClientDto } from './dto/update-client.dto';
import { Client } from './entities/client.entity';

@Injectable()
export class ClientsService {
  constructor(
    @InjectRepository(Client)
    private readonly clientsRepository: Repository<Client>,
  ) {}

  async findAll(): Promise<Client[]> {
    return this.clientsRepository.find();
  }

  async findOne(id: string): Promise<Client> {
    const client = await this.clientsRepository.findOne({ where: { id } });
    if (!client) {
      throw new NotFoundException(`Client with id "${id}" not found`);
    }
    return client;
  }

  async findByClerkId(clerkId: string): Promise<Client | null> {
    return this.clientsRepository.findOne({ where: { clerkId } });
  }

  async createOrUpdateFromClerk(
    clerkId: string,
    data: Partial<CreateClientDto>,
  ): Promise<Client> {
    const existing = await this.findByClerkId(clerkId);
    if (existing) {
      Object.assign(existing, {
        ...data,
        email: data.email?.toLowerCase() ?? existing.email,
        updatedAt: new Date(),
      });
      return this.clientsRepository.save(existing);
    }

    if (data.email) {
      await this.guardDuplicateEmail(data.email.toLowerCase());
    }

    const client = this.clientsRepository.create({
      ...data,
      clerkId,
      email: data.email?.toLowerCase() ?? null,
      onboardingCompleted: data.defaultMunicipalityId !== undefined,
    });

    return this.clientsRepository.save(client);
  }

  async create(createClientDto: CreateClientDto): Promise<Client> {
    await this.guardDuplicateClerkId(createClientDto.clerkId);
    if (createClientDto.email) {
      await this.guardDuplicateEmail(createClientDto.email.toLowerCase());
    }

    const client = this.clientsRepository.create({
      ...createClientDto,
      email: createClientDto.email?.toLowerCase() ?? null,
      onboardingCompleted:
        createClientDto.defaultMunicipalityId !== undefined ||
        createClientDto.onboardingCompleted === true,
    });

    return this.clientsRepository.save(client);
  }

  async update(id: string, updateClientDto: UpdateClientDto): Promise<Client> {
    const client = await this.findOne(id);

    if (updateClientDto.email) {
      const email = updateClientDto.email.toLowerCase();
      await this.guardDuplicateEmail(email, id);
      client.email = email;
    }

    Object.assign(client, updateClientDto);
    return this.clientsRepository.save(client);
  }

  async remove(id: string): Promise<void> {
    const result = await this.clientsRepository.softDelete(id);
    if (result.affected === 0) {
      throw new NotFoundException(`Client with id "${id}" not found`);
    }
  }

  async removeByClerkId(clerkId: string): Promise<void> {
    const client = await this.findByClerkId(clerkId);
    if (client) {
      await this.clientsRepository.softDelete(client.id);
    }
  }

  private async guardDuplicateEmail(
    email: string,
    excludeId?: string,
  ): Promise<void> {
    const existing = await this.clientsRepository.findOne({
      where: { email },
      withDeleted: true,
    });

    if (existing && existing.id !== excludeId) {
      throw new ConflictException(
        `A client with email "${email}" already exists`,
      );
    }
  }

  private async guardDuplicateClerkId(
    clerkId: string,
    excludeId?: string,
  ): Promise<void> {
    const existing = await this.clientsRepository.findOne({
      where: { clerkId },
      withDeleted: true,
    });

    if (existing && existing.id !== excludeId) {
      throw new ConflictException(
        `A client with clerkId "${clerkId}" already exists`,
      );
    }
  }
}
