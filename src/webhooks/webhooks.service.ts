import {
  BadRequestException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { verifyWebhook } from '@clerk/backend/webhooks';
import { ClientsService } from '../clients/clients.service';
import { InvitationsService } from '../users/invitations.service';
import { UsersService } from '../users/users.service';

interface ClerkWebhookPayload {
  type: string;
  data: Record<string, unknown>;
}

interface ClerkEmailAddress {
  id: string;
  email_address: string;
}

@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly clientsService: ClientsService,
    private readonly usersService: UsersService,
    private readonly invitationsService: InvitationsService,
  ) {}

  async handleStoreWebhook(
    rawBody: string,
    headers: Record<string, string | string[] | undefined>,
  ): Promise<{ processed: boolean }> {
    const secret = this.configService.get<string>('clerk.webhookSecret');
    const payload = await this.verifyWebhook(rawBody, headers, secret);

    this.logger.log(`Received storefront Clerk webhook: ${payload.type}`);

    switch (payload.type) {
      case 'user.created':
      case 'user.updated':
        await this.upsertClient(payload.data);
        break;
      case 'user.deleted':
        await this.clientsService.removeByClerkId(payload.data.id as string);
        break;
      case 'session.created':
      case 'session.ended':
      case 'session.removed':
      case 'session.revoked':
        this.logger.log(
          `Storefront session event ${payload.type} for user ${payload.data.user_id as string}`,
        );
        break;
      default:
        this.logger.debug(
          `Unhandled storefront Clerk webhook type: ${payload.type}`,
        );
    }

    return { processed: true };
  }

  async handleAdminWebhook(
    rawBody: string,
    headers: Record<string, string | string[] | undefined>,
  ): Promise<{ processed: boolean }> {
    const secret = this.configService.get<string>(
      'clerk.backofficeWebhookSecret',
    );
    const payload = await this.verifyWebhook(rawBody, headers, secret);

    this.logger.log(`Received admin Clerk webhook: ${payload.type}`);

    switch (payload.type) {
      case 'user.created':
        await this.createAdminUserFromInvitation(payload.data);
        break;
      case 'user.updated':
        await this.updateAdminUser(payload.data);
        break;
      case 'user.deleted':
        await this.usersService.deactivateByClerkId(payload.data.id as string);
        break;
      case 'session.created':
      case 'session.ended':
      case 'session.removed':
      case 'session.revoked':
        this.logger.log(
          `Admin session event ${payload.type} for user ${payload.data.user_id as string}`,
        );
        break;
      default:
        this.logger.debug(
          `Unhandled admin Clerk webhook type: ${payload.type}`,
        );
    }

    return { processed: true };
  }

  private async verifyWebhook(
    rawBody: string,
    headers: Record<string, string | string[] | undefined>,
    secret: string | undefined,
  ): Promise<ClerkWebhookPayload> {
    if (!secret) {
      // A deployed environment MUST verify signatures. The unsigned path exists
      // only for local/test and must be opted into explicitly and visibly.
      const allowUnverified = this.configService.get<boolean>(
        'auth.allowUnverifiedWebhooks',
      );
      if (!allowUnverified) {
        throw new UnauthorizedException(
          'Clerk webhook secret is not configured',
        );
      }
      this.logger.warn(
        'ALLOW_UNVERIFIED_WEBHOOKS is set — skipping Clerk webhook signature verification',
      );
      try {
        return JSON.parse(rawBody) as ClerkWebhookPayload;
      } catch {
        throw new BadRequestException('Invalid JSON webhook payload');
      }
    }

    const request = new Request('https://maxihabana.webhooks/clerk', {
      method: 'POST',
      headers: this.buildHeaders(headers),
      body: rawBody,
    });

    return (await verifyWebhook(request, {
      signingSecret: secret,
    })) as unknown as ClerkWebhookPayload;
  }

  private buildHeaders(
    headers: Record<string, string | string[] | undefined>,
  ): Headers {
    const h = new Headers();
    for (const [key, value] of Object.entries(headers)) {
      if (value === undefined) {
        continue;
      }
      if (Array.isArray(value)) {
        value.forEach((v) => h.append(key, v));
      } else {
        h.set(key, value);
      }
    }
    return h;
  }

  private async upsertClient(data: Record<string, unknown>): Promise<void> {
    const clerkId = data.id as string;
    const email = this.extractPrimaryEmail(data);
    const firstName = (data.first_name as string | null) ?? undefined;
    const lastName = (data.last_name as string | null) ?? undefined;

    await this.clientsService.createOrUpdateFromClerk(clerkId, {
      email: email ?? undefined,
      firstName,
      lastName,
    });
  }

  private async createAdminUserFromInvitation(
    data: Record<string, unknown>,
  ): Promise<void> {
    const clerkId = data.id as string;
    const email = this.extractPrimaryEmail(data);
    if (!email) {
      this.logger.warn(
        `Skipping admin user creation for ${clerkId}: no primary email`,
      );
      return;
    }

    const invitation = await this.invitationsService.findPendingByEmail(email);
    if (!invitation) {
      this.logger.warn(
        `No pending invitation found for ${email}; skipping unauthorized admin user creation`,
      );
      return;
    }

    const firstName = (data.first_name as string | null) ?? undefined;
    const lastName = (data.last_name as string | null) ?? undefined;
    const { phone, businessName } = this.extractProfileMetadata(data);

    await this.usersService.createOrUpdateFromClerk(clerkId, {
      email,
      firstName,
      lastName,
      role: invitation.role,
      phone,
      businessName,
    });

    await this.invitationsService.markAccepted(invitation);
    this.logger.log(`Created admin user from invitation: ${email}`);
  }

  private async updateAdminUser(data: Record<string, unknown>): Promise<void> {
    const clerkId = data.id as string;
    const email = this.extractPrimaryEmail(data);
    const firstName = (data.first_name as string | null) ?? undefined;
    const lastName = (data.last_name as string | null) ?? undefined;
    const { phone, businessName } = this.extractProfileMetadata(data);

    await this.usersService.createOrUpdateFromClerk(clerkId, {
      email: email ?? undefined,
      firstName,
      lastName,
      role: undefined,
      phone,
      businessName,
    });
  }

  private extractPrimaryEmail(
    data: Record<string, unknown>,
  ): string | undefined {
    const emails = data.email_addresses as ClerkEmailAddress[] | undefined;
    if (!emails || emails.length === 0) {
      return undefined;
    }
    const primaryId = data.primary_email_address_id as string | undefined;
    const primary = primaryId
      ? emails.find((e) => e.id === primaryId)
      : undefined;
    return (primary ?? emails[0]).email_address;
  }

  /**
   * Profile fields collected during invitation acceptance are stored in the
   * Clerk sign-up's `unsafeMetadata`, which Clerk copies onto the user and
   * echoes back here as `unsafe_metadata`. Empty strings are treated as absent.
   */
  private extractProfileMetadata(data: Record<string, unknown>): {
    phone?: string;
    businessName?: string;
  } {
    const meta = data.unsafe_metadata as Record<string, unknown> | undefined;
    if (!meta) {
      return {};
    }
    const phone =
      typeof meta.phone === 'string' && meta.phone.length > 0
        ? meta.phone
        : undefined;
    const businessName =
      typeof meta.businessName === 'string' && meta.businessName.length > 0
        ? meta.businessName
        : undefined;
    return { phone, businessName };
  }
}
