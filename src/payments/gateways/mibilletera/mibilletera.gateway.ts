import {
  BadRequestException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { PaymentsConfig } from '../../../config/configuration';
import { Order } from '../../../orders/entities/order.entity';
import {
  ChargeStatus,
  PaymentCharge,
  TERMINAL_CHARGE_STATUSES,
} from '../../entities/payment-charge.entity';
import {
  GatewayCharge,
  GatewayWebhookEvent,
  PaymentActionKind,
  PaymentGateway,
} from '../../payment-gateway.interface';
import { MibiChargeData, MibiClient } from './mibi-client';

interface MibiWebhookEvent {
  event: string;
  reference: string;
  status?: string;
  metadata?: Record<string, unknown>;
  [key: string]: unknown;
}

// The dev-panel callback contract only guarantees the event name; `status`
// comes from the exported doc's sample and may be absent.
const EVENT_STATUSES: Record<string, ChargeStatus> = {
  'charge.succeeded': ChargeStatus.SUCCEEDED,
  'charge.failed': ChargeStatus.FAILED,
  'charge.expired': ChargeStatus.EXPIRED,
  'charge.cancelled': ChargeStatus.CANCELLED,
};

/**
 * Mi Billetera merchant charges. Unlike a hosted checkout, the platform decides
 * nothing: whatever `method` we put on the charge is the experience the
 * customer gets — a deposit address (CRYPTO) or a payment request they approve
 * in the app (WALLET). Subclasses pick one; everything else is shared, down to
 * the credentials and the webhook secret.
 *
 * The gateway rule that shapes the rest: an order is paid ONLY when a charge
 * reaches SUCCEEDED, and an expired/failed attempt is never reused — a retry is
 * a NEW charge with a NEW idempotency key (PaymentsService supplies it).
 */
@Injectable()
export class MibilleteraGateway extends PaymentGateway {
  readonly code: string = 'mibilletera';
  readonly kind: PaymentActionKind = 'instructions';

  /** What the customer is asked to do. Overridden by the wallet variant. */
  protected readonly method: 'CRYPTO' | 'WALLET' = 'CRYPTO';

  private readonly logger = new Logger(MibilleteraGateway.name);

  constructor(
    private readonly mibiClient: MibiClient,
    private readonly configService: ConfigService,
  ) {
    super();
  }

  private get config() {
    return this.configService.get<PaymentsConfig>('payments')!.mibi;
  }

  get configured(): boolean {
    return this.config.configured;
  }

  async createCharge(
    order: Order,
    idempotencyKey: string,
  ): Promise<GatewayCharge> {
    const data = await this.mibiClient.createCharge({
      method: this.method,
      amount: Number(order.total).toFixed(2),
      // Must match a receiving account bound to the merchant payment account.
      currency: this.config.currency,
      description: `Orden ${order.orderNumber ?? order.id}`,
      idempotency_key: idempotencyKey,
      metadata: { order_id: order.id },
    });
    return this.toGatewayCharge(data);
  }

  async syncCharge(charge: PaymentCharge): Promise<GatewayCharge> {
    return this.toGatewayCharge(
      await this.mibiClient.getCharge(charge.reference),
    );
  }

  parseWebhook(
    rawBody: string,
    headers: Record<string, string | string[] | undefined>,
  ): GatewayWebhookEvent {
    this.verifySignature(rawBody, headers);

    let event: MibiWebhookEvent;
    try {
      event = JSON.parse(rawBody) as MibiWebhookEvent;
    } catch {
      throw new BadRequestException('Invalid JSON webhook payload');
    }

    const status =
      (event.status as ChargeStatus) ?? EVENT_STATUSES[event.event];
    if (!status) {
      throw new BadRequestException(
        `Unrecognized Mi Billetera webhook event "${event.event}"`,
      );
    }
    return {
      reference: event.reference,
      charge: {
        status,
        feeAmount:
          typeof event.fee_amount === 'string' ? event.fee_amount : undefined,
        settlementAmount:
          typeof event.net_amount === 'string' ? event.net_amount : undefined,
        completedAt: TERMINAL_CHARGE_STATUSES.includes(status)
          ? new Date()
          : undefined,
        rawPayload: event,
      },
    };
  }

  // HMAC-SHA256 over the RAW body, hex digest in X-Mibi-Signature. Missing
  // secret: hard failure in production, bypass with a warning in dev/test
  // (same policy as the Clerk webhooks).
  private verifySignature(
    rawBody: string,
    headers: Record<string, string | string[] | undefined>,
  ): void {
    const secret = this.config.webhookSecret;
    if (!secret) {
      if (this.configService.get<string>('nodeEnv') === 'production') {
        throw new UnauthorizedException(
          'Mi Billetera webhook secret is not configured',
        );
      }
      this.logger.warn(
        'Skipping Mi Billetera webhook signature verification in dev/test mode',
      );
      return;
    }

    const header = headers['x-mibi-signature'];
    const signature = Array.isArray(header) ? header[0] : (header ?? '');
    const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
    const valid =
      signature.length === expected.length &&
      timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
    if (!valid) {
      throw new UnauthorizedException('Invalid Mi Billetera signature');
    }
  }

  private toGatewayCharge(data: MibiChargeData): GatewayCharge {
    return {
      reference: data.reference,
      status: data.status as ChargeStatus,
      amount: data.amount,
      currency: data.currency,
      feeAmount: data.fee_amount ?? null,
      settlementAmount: data.settlement_amount ?? data.net_amount ?? null,
      // Deposit instructions (address, token, blockchain) come exclusively from
      // here — the gateway decides the network, we never hardcode it.
      actionPayload: data.action_payload ?? null,
      redirectUrl: null,
      errorMessage: data.error_message || null,
      expiresAt: data.expires_at ? new Date(data.expires_at) : null,
      completedAt: data.completed_at ? new Date(data.completed_at) : null,
      rawPayload: data,
    };
  }
}
