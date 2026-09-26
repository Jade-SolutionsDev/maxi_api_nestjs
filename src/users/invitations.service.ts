import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { createClerkClient } from '@clerk/backend';
import { Repository } from 'typeorm';
import {
  isSystemAdmin,
  PermissionsService,
} from '../permissions/permissions.service';
import { InviteUserDto } from './dto/invite-user.dto';
import { Invitation, InvitationStatus } from './entities/invitation.entity';
import { Role, User } from './entities/user.entity';

/**
 * Forma de un error del SDK de Clerk. No se importa su tipo a propósito: el
 * SDK cambia de versión y aquí solo hacen falta tres campos, leídos a la
 * defensiva. Si algún día llega otra cosa, el traductor cae en el caso
 * general en vez de romperse.
 */
interface ErrorDeClerk {
  status?: number;
  errors?: Array<{ code?: string; message?: string; longMessage?: string }>;
}

/** Códigos con los que Clerk dice «ese correo ya está cogido». */
const YA_EXISTE = new Set([
  'duplicate_record',
  'form_identifier_exists',
  'identifier_already_signed_up',
]);

@Injectable()
export class InvitationsService {
  private readonly logger = new Logger(InvitationsService.name);

  constructor(
    @InjectRepository(Invitation)
    private readonly invitationRepository: Repository<Invitation>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly configService: ConfigService,
    private readonly permissionsService: PermissionsService,
  ) {}

  async createAndSendInvitation(
    dto: InviteUserDto,
    inviter: User,
  ): Promise<Invitation> {
    const normalizedEmail = dto.email.toLowerCase().trim();

    // Admin tiers bypass permissions — roles on their invitation would be a
    // client bug, so reject loudly instead of silently dropping them. STAFF
    // role ids must exist and be active NOW; the webhook assigns leniently
    // later (a role deleted in between is simply skipped).
    const roleIds = [...new Set(dto.roleIds ?? [])];
    if (isSystemAdmin(dto.role) && roleIds.length > 0) {
      throw new BadRequestException(
        'Admin tiers do not take managed roles on an invitation',
      );
    }
    if (dto.role === Role.STAFF) {
      await this.permissionsService.assertActiveRoles(roleIds);
    }

    const existingUser = await this.userRepository.findOne({
      where: { email: normalizedEmail, isActive: true },
    });
    if (existingUser) {
      throw new ConflictException(
        `Ya hay un usuario activo con el correo ${normalizedEmail}. Si lo borraste, revisa la lista de usuarios: puede seguir ahí desactivado.`,
      );
    }

    const existingPending = await this.invitationRepository.findOne({
      where: { email: normalizedEmail, status: InvitationStatus.PENDING },
    });
    if (existingPending) {
      throw new ConflictException(
        `Ya hay una invitación pendiente para ${normalizedEmail}. Reenvíala o anúlala desde la lista de invitaciones antes de crear otra.`,
      );
    }

    // Si Clerk falla, `sendClerkInvitation` lanza con el motivo traducido: no
    // se llega aquí con las manos vacías, y por eso no hay que comprobarlo.
    const clerkInvitation = await this.sendClerkInvitation(dto, inviter);

    const invitation = this.invitationRepository.create({
      email: normalizedEmail,
      role: dto.role,
      roleIds,
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
  ): Promise<{ id: string }> {
    const secretKey = this.configService.get<string>(
      'clerk.backofficeSecretKey',
    );
    if (!secretKey) {
      throw new Error('CLERK_BACKOFFICE_SECRET_KEY is not configured');
    }

    const clerkClient = createClerkClient({ secretKey });
    const publicMetadata: Record<string, unknown> = { role: dto.role };

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
      dto.email,
    );

    if (dto.organizationId) {
      const isAdmin = dto.role === Role.ADMIN || dto.role === Role.SUPER_ADMIN;
      const role = isAdmin ? 'org:admin' : 'org:member';
      this.logger.log(
        `Sending organization invitation to ${dto.email} for org ${dto.organizationId} with role ${role}`,
      );
      try {
        const invitation =
          await clerkClient.organizations.createOrganizationInvitation({
            organizationId: dto.organizationId,
            emailAddress: dto.email,
            role,
            inviterUserId: inviter.clerkId ?? undefined,
            publicMetadata,
          });
        return { id: invitation.id };
      } catch (e) {
        // El mismo trato que la invitación normal: por aquí pasan las
        // invitaciones a una organización, y fallaban igual de mudas.
        throw this.traducirFalloDeClerk(e, dto.email);
      }
    }

    // Clerk sends the invitation email itself via `notify`; the flag is off in
    // local/e2e runs to suppress outbound emails (NOTIFICATIONS_ENABLED=false).
    const notify =
      this.configService.get<boolean>('notifications.enabled') ?? true;

    this.logger.log(`Sending app invitation to ${dto.email}`);
    try {
      const invitation = await clerkClient.invitations.createInvitation({
        emailAddress: dto.email,
        publicMetadata,
        redirectUrl,
        notify,
      });
      this.logger.log(
        `Invitation sent to ${dto.email} with ID ${invitation.id}`,
      );

      return { id: invitation.id };
    } catch (e) {
      throw this.traducirFalloDeClerk(e, dto.email);
    }
  }

  /**
   * Convierte un fallo de Clerk en algo que el panel pueda enseñar.
   *
   * Antes este error se registraba y se descartaba: la función devolvía vacío,
   * quien llamaba lanzaba un `Error` pelado y al usuario le llegaba un 500 con
   * «error inesperado». Pasó de verdad el 26-sep-2026: se borró un usuario, se
   * intentó invitarlo otra vez y el panel solo dijo que algo había fallado. La
   * causa real —su cuenta seguía viva en Clerk— no aparecía por ninguna parte,
   * ni siquiera en los registros del servidor.
   *
   * El correo repetido tiene mensaje propio porque es el caso frecuente y
   * tiene salida conocida: restaurar al usuario en vez de reinvitarlo. Lo
   * demás sale como 503, que es lo honesto cuando el que falla es un tercero.
   */
  private traducirFalloDeClerk(e: unknown, email: string): Error {
    const clerk = e as ErrorDeClerk;
    const primero = clerk?.errors?.[0];
    const detalle = primero?.longMessage ?? primero?.message ?? String(e);

    this.logger.error(
      `Clerk rechazó la invitación de ${email}: ${primero?.code ?? 'sin código'} · ${detalle}`,
      e instanceof Error ? e.stack : undefined,
    );

    if (primero?.code && YA_EXISTE.has(primero.code)) {
      return new ConflictException(
        `Clerk ya tiene una cuenta con el correo ${email}, así que no admite una invitación nueva. ` +
          'Si borraste a esa persona, actívale «Mostrar eliminados» en la lista de usuarios y restáurala: ' +
          'su cuenta sigue existiendo y no necesita invitación.',
      );
    }

    return new ServiceUnavailableException(
      `Clerk no pudo enviar la invitación a ${email}: ${detalle}`,
    );
  }

  private buildInvitationRedirectUrl(
    baseUrl: string | undefined,
    firstName?: string,
    lastName?: string,
    email?: string,
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
    // Lets the acceptance page send the same email to the storefront-mirror
    // endpoint (the Clerk ticket doesn't expose it to our page directly).
    if (email?.trim()) {
      url.searchParams.set('email', email.trim());
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

  /**
   * Revoke a pending invitation. Idempotent for already-revoked invitations;
   * rejects revoking an accepted one. Best-effort revoke on Clerk's side.
   */
  async revoke(id: string): Promise<Invitation> {
    const invitation = await this.findOne(id);

    if (invitation.status === InvitationStatus.REVOKED) {
      return invitation;
    }
    if (invitation.status === InvitationStatus.ACCEPTED) {
      throw new ConflictException('Cannot revoke an accepted invitation.');
    }

    if (invitation.clerkInvitationId) {
      await this.revokeClerkInvitation(invitation.clerkInvitationId);
    }

    invitation.status = InvitationStatus.REVOKED;
    return this.invitationRepository.save(invitation);
  }

  /**
   * Anula las invitaciones pendientes de un correo. Se llama al borrar un
   * usuario: si se le invitó y se le borró antes de que aceptara, la
   * invitación seguía viva y bloqueaba volver a invitarlo.
   *
   * Es a prueba de fallos a propósito: que Clerk no responda no puede impedir
   * que el usuario se borre.
   */
  async revokePendingForEmail(email: string | null): Promise<number> {
    const normalizedEmail = email?.toLowerCase().trim();
    if (!normalizedEmail) {
      return 0;
    }
    const pendientes = await this.invitationRepository.find({
      where: { email: normalizedEmail, status: InvitationStatus.PENDING },
    });
    for (const invitation of pendientes) {
      try {
        await this.revoke(invitation.id);
      } catch (err) {
        this.logger.warn(
          `No se pudo anular la invitación ${invitation.id} de ${normalizedEmail}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }
    return pendientes.length;
  }

  /**
   * Re-issue a pending or revoked invitation: revoke the stale Clerk invitation
   * (if any), send a fresh one, and reset the local record to PENDING.
   */
  async resend(id: string, inviter: User): Promise<Invitation> {
    const invitation = await this.findOne(id);

    if (invitation.status === InvitationStatus.ACCEPTED) {
      throw new ConflictException('Cannot resend an accepted invitation.');
    }

    if (
      invitation.clerkInvitationId &&
      invitation.status === InvitationStatus.PENDING
    ) {
      await this.revokeClerkInvitation(invitation.clerkInvitationId);
    }

    const clerkInvitation = await this.sendClerkInvitation(
      {
        email: invitation.email,
        role: invitation.role,
        firstName: invitation.firstName ?? undefined,
        lastName: invitation.lastName ?? undefined,
        organizationId: invitation.organizationId ?? undefined,
      },
      inviter,
    );

    invitation.clerkInvitationId = clerkInvitation.id;
    invitation.status = InvitationStatus.PENDING;
    return this.invitationRepository.save(invitation);
  }

  private async revokeClerkInvitation(
    clerkInvitationId: string,
  ): Promise<void> {
    const secretKey = this.configService.get<string>(
      'clerk.backofficeSecretKey',
    );
    if (!secretKey) {
      this.logger.warn(
        `No backoffice Clerk secret configured; skipping remote revoke of ${clerkInvitationId}`,
      );
      return;
    }
    try {
      const clerkClient = createClerkClient({ secretKey });
      await clerkClient.invitations.revokeInvitation(clerkInvitationId);
    } catch (e) {
      this.logger.error(
        `Failed to revoke Clerk invitation ${clerkInvitationId}: ${e}`,
      );
    }
  }
}
