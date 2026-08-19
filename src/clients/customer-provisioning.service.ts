import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { createClerkClient } from '@clerk/backend';
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
