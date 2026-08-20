import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { createClerkClient, verifyToken } from '@clerk/backend';
import { Repository } from 'typeorm';
import { Client } from './entities/client.entity';

interface ProvisionInput {
  email: string;
  password: string;
  firstName?: string | null;
  lastName?: string | null;
  phone?: string | null;
}

/**
 * Mirrors an invited admin (backoffice Clerk / `users`) into a STOREFRONT
 * customer (storefront Clerk / `clients`) so approved admins can shop with the
 * same email + password.
 *
 * The password is only available at invitation sign-up (it never otherwise
 * reaches our backend); it is forwarded straight to storefront Clerk and never
 * persisted. The mirrored customer is created DISABLED and only enabled when the
 * admin is approved (removed if rejected). A pre-existing storefront customer
 * with the same email is left completely untouched.
 */
@Injectable()
export class CustomerProvisioningService {
  private readonly logger = new Logger(CustomerProvisioningService.name);

  constructor(
    private readonly configService: ConfigService,
    @InjectRepository(Client)
    private readonly clientsRepository: Repository<Client>,
  ) {}

  private storefrontClerk() {
    const secretKey = this.configService.get<string>('clerk.secretKey');
    if (!secretKey) {
      throw new Error('CLERK_SECRET_KEY is not configured');
    }
    return createClerkClient({ secretKey });
  }

  /**
   * Proof that the mirror caller IS the invitee: verify the Bearer token against
   * the BACKOFFICE Clerk instance (where the admin just signed up) and confirm
   * its user's email matches the one being provisioned. This is the gate for the
   * public mirror endpoint — it closes both the invitation-enumeration oracle
   * and the attacker-chosen-password pre-claim. Any failure returns false; the
   * caller rejects uniformly, so nothing distinguishes invited from not-invited.
   */
  async tokenOwnsEmail(token: string, claimedEmail: string): Promise<boolean> {
    const secretKey = this.configService.get<string>(
      'clerk.backofficeSecretKey',
    );
    if (!secretKey) {
      this.logger.warn(
        'CLERK_BACKOFFICE_SECRET_KEY is not configured; rejecting mirror call.',
      );
      return false;
    }
    try {
      const { sub } = await verifyToken(token, { secretKey });
      if (!sub) return false;
      const user = await createClerkClient({ secretKey }).users.getUser(sub);
      const primary =
        user.emailAddresses.find((e) => e.id === user.primaryEmailAddressId) ??
        user.emailAddresses[0];
      const email = primary?.emailAddress?.toLowerCase();
      return !!email && email === claimedEmail.toLowerCase();
    } catch (err) {
      this.logger.warn(
        `Mirror token verification failed: ${
          err instanceof Error ? err.message : 'unknown error'
        }`,
      );
      return false;
    }
  }

  /**
   * Create a gated storefront customer for a just-invited admin. Idempotent: if
   * a storefront Clerk user already owns this email (a real customer), nothing
   * is touched. The password is used once and never stored.
   */
  async provisionPending(input: ProvisionInput): Promise<void> {
    const email = input.email.toLowerCase();
    const clerk = this.storefrontClerk();

    const existing = await clerk.users.getUserList({ emailAddress: [email] });
    if (existing.data.length > 0) {
      this.logger.log(
        `Storefront user already exists for ${email}; leaving it untouched.`,
      );
      return;
    }

    const created = await clerk.users.createUser({
      emailAddress: [email],
      password: input.password,
      firstName: input.firstName || undefined,
      lastName: input.lastName || undefined,
      skipPasswordChecks: true,
      skipLegalChecks: true,
      publicMetadata: { adminInvitePending: true },
    });

    // Write the DB mirror directly (gated). Reuse a lingering soft-deleted row
    // for this email — e.g. a previously rejected+revoked invitation.
    const row =
      (await this.clientsRepository.findOne({
        where: { email },
        withDeleted: true,
      })) ?? this.clientsRepository.create({ email });
    row.clerkId = created.id;
    row.firstName = input.firstName ?? row.firstName ?? null;
    row.lastName = input.lastName ?? row.lastName ?? null;
    row.phone = input.phone ?? row.phone ?? null;
    row.isActive = false;
    row.adminInvitePending = true;
    row.deletedAt = null;
    await this.clientsRepository.save(row);

    this.logger.log(`Provisioned gated storefront customer for ${email}.`);
  }

  /** Enable the gated customer of a just-approved admin (linked by email). */
  async activateForEmail(email: string | null): Promise<void> {
    const client = await this.findPendingByEmail(email);
    if (!client) return;

    client.isActive = true;
    client.adminInvitePending = false;
    await this.clientsRepository.save(client);

    try {
      await this.storefrontClerk().users.updateUserMetadata(client.clerkId, {
        publicMetadata: { adminInvitePending: false },
      });
    } catch (err) {
      this.logger.warn(
        `Could not clear storefront metadata for ${email}: ${String(err)}`,
      );
    }
    this.logger.log(`Activated storefront customer for ${email}.`);
  }

  /** Remove the gated customer of a rejected admin (Clerk user + client row). */
  async revokeForEmail(email: string | null): Promise<void> {
    const client = await this.findPendingByEmail(email);
    if (!client) return;

    try {
      await this.storefrontClerk().users.deleteUser(client.clerkId);
    } catch (err) {
      this.logger.warn(
        `Could not delete storefront Clerk user for ${email}: ${String(err)}`,
      );
    }
    await this.clientsRepository.softDelete(client.id);
    this.logger.log(`Revoked storefront customer for ${email}.`);
  }

  /** The customer we provisioned for this email, only if still admin-pending. */
  private async findPendingByEmail(
    email: string | null,
  ): Promise<Client | null> {
    if (!email) return null;
    const client = await this.clientsRepository.findOne({
      where: { email: email.toLowerCase() },
    });
    return client?.adminInvitePending ? client : null;
  }
}
