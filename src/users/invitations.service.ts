import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { createClerkClient } from '@clerk/backend';
import { Repository } from 'typeorm';
import { InviteUserDto } from './dto/invite-user.dto';
import { Invitation, InvitationStatus } from './entities/invitation.entity';
import { User, UserType } from './entities/user.entity';

@Injectable()
export class InvitationsService {
  private readonly logger = new Logger(InvitationsService.name);

  constructor(
    @InjectRepository(Invitation)
    private readonly invitationRepository: Repository<Invitation>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly configService: ConfigService,
  ) {}

  async createAndSendInvitation(
    dto: InviteUserDto,
    inviter: User,
  ): Promise<Invitation> {
    const normalizedEmail = dto.email.toLowerCase().trim();

    const existingUser = await this.userRepository.findOne({
      where: { email: normalizedEmail, isActive: true },
    });
    if (existingUser) {
      throw new ConflictException(
        `An active user with email ${normalizedEmail} already exists.`,
      );
    }

    const existingPending = await this.invitationRepository.findOne({
      where: { email: normalizedEmail, status: InvitationStatus.PENDING },
    });
    if (existingPending) {
      throw new ConflictException(
        `A pending invitation for ${normalizedEmail} already exists.`,
      );
    }

    const clerkInvitation = await this.sendClerkInvitation(dto, inviter);

    if (!clerkInvitation)
      throw new Error(
        `Failed to send invitation to ${normalizedEmail} via Clerk.`,
      );

    const invitation = this.invitationRepository.create({
      email: normalizedEmail,
      userType: dto.userType,
      firstName: dto.firstName ?? null,
      lastName: dto.lastName ?? null,
      invitedById: inviter.id,
      organizationId: dto.organizationId ?? null,
      clerkInvitationId: clerkInvitation?.id ?? null,
      status: InvitationStatus.PENDING,
    });

    return this.invitationRepository.save(invitation);
  }

  private async sendClerkInvitation(
    dto: InviteUserDto,
    inviter: User,
  ): Promise<{ id: string } | undefined> {
    const secretKey = this.configService.get<string>(
      'clerk.backofficeSecretKey',
    );
    if (!secretKey) {
      throw new Error('CLERK_BACKOFFICE_SECRET_KEY is not configured');
    }

    const clerkClient = createClerkClient({ secretKey });
    const publicMetadata: Record<string, unknown> = { userType: dto.userType };

    // Prefill firstName/lastName on the invitation redirect so the acceptance
    // form can show them to the user while still allowing edits. We keep them
    // in the URL rather than publicMetadata because Clerk doesn't expose custom
    // invitation metadata on the ticket URL, but the redirect URL is under our
    // control and these fields are not sensitive.
    const baseRedirectUrl = this.configService.get<string>(
      'clerk.invitationRedirectUrl',
    );
    const redirectUrl = this.buildInvitationRedirectUrl(
      baseRedirectUrl,
      dto.firstName,
      dto.lastName,
    );

    if (dto.organizationId) {
      const role = dto.userType === UserType.ADMIN ? 'org:admin' : 'org:member';
      this.logger.log(
        `Sending organization invitation to ${dto.email} for org ${dto.organizationId} with role ${role}`,
      );
      const invitation =
        await clerkClient.organizations.createOrganizationInvitation({
          organizationId: dto.organizationId,
          emailAddress: dto.email,
          role,
          inviterUserId: inviter.clerkId ?? undefined,
          publicMetadata,
        });
      return { id: invitation.id };
    }

    this.logger.log(`Sending app invitation to ${dto.email}`);
    try {
      const invitation = await clerkClient.invitations.createInvitation({
        emailAddress: dto.email,
        publicMetadata,
        redirectUrl,
        notify: true,
      });
      this.logger.log(
        `Invitation sent to ${dto.email} with ID ${invitation.id}`,
      );

      return { id: invitation.id };
    } catch (e) {
      this.logger.error(`Failed to send invitation to ${dto.email}: ${e}`);
    }
  }

  private buildInvitationRedirectUrl(
    baseUrl: string | undefined,
    firstName?: string,
    lastName?: string,
  ): string | undefined {
    if (!baseUrl) {
      return undefined;
    }
    const url = new URL(baseUrl);
    if (firstName?.trim()) {
      url.searchParams.set('firstName', firstName.trim());
    }
    if (lastName?.trim()) {
      url.searchParams.set('lastName', lastName.trim());
    }
    return url.toString();
  }

  async findPendingByEmail(email: string): Promise<Invitation | null> {
    return this.invitationRepository.findOne({
      where: {
        email: email.toLowerCase().trim(),
        status: InvitationStatus.PENDING,
      },
      relations: { invitedBy: true },
    });
  }

  async markAccepted(invitation: Invitation): Promise<Invitation> {
    invitation.status = InvitationStatus.ACCEPTED;
    invitation.acceptedAt = new Date();
    return this.invitationRepository.save(invitation);
  }

  async findOne(id: string): Promise<Invitation> {
    const invitation = await this.invitationRepository.findOne({
      where: { id },
      relations: { invitedBy: true },
    });
    if (!invitation) {
      throw new NotFoundException(`Invitation ${id} not found.`);
    }
    return invitation;
  }
}
