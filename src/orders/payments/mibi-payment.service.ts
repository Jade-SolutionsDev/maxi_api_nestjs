import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { Repository } from 'typeorm';
import { MibiConfig } from '../../config/configuration';
import { Order, PaymentStatus } from '../entities/order.entity';
import {
  ChargeStatus,
  PaymentCharge,
  TERMINAL_CHARGE_STATUSES,
} from './entities/payment-charge.entity';
import { MibiChargeData, MibiClient } from './mibi-client';

interface MibiWebhookEvent {
  event: string;
  reference: string;
  status: string;
  metadata?: Record<string, unknown>;
  [key: string]: unknown;
}

// Mi Billetera charge lifecycle: create at checkout, sync by polling, settle
// via signed webhooks. The gateway rule that drives the shape of everything
// here: an order is paid ONLY when a charge reaches SUCCEEDED, and an
// expired/failed attempt is never reused — a retry is a NEW charge with a NEW
// idempotency key.
@Injectable()
export class MibiPaymentService {
  private readonly logger = new Logger(MibiPaymentService.name);

  constructor(
    @InjectRepository(PaymentCharge)
    private readonly chargeRepository: Repository<PaymentCharge>,
    @InjectRepository(Order)
    private readonly orderRepository: Repository<Order>,
    private readonly mibiClient: MibiClient,
    private readonly configService: ConfigService,
  ) {}

  /** Latest charge of an order, if any (newest attempt wins). */
  async latestChargeFor(orderId: string): Promise<PaymentCharge | null> {
    return this.chargeRepository.findOne({
      where: { orderId },
      order: { createdAt: 'DESC' },
    });
  }

  // A charge the customer can still act on: non-terminal and not past its
  // action window.
  private isLive(charge: PaymentCharge): boolean {
    return (
      !TERMINAL_CHARGE_STATUSES.includes(charge.status) &&
      (!charge.expiresAt || charge.expiresAt.getTime() > Date.now())
    );
  }

  // Creates the next payment attempt for an order. Idempotency key embeds the
  // attempt number so a retry after EXPIRED/FAILED never collides (gateway
  // 409s on key reuse with a different payload).
  async createChargeForOrder(order: Order): Promise<PaymentCharge> {
    const attempt =
      (await this.chargeRepository.count({
        where: { orderId: order.id },
      })) + 1;

    // Settlement currency must match a receiving account bound to the merchant
    // payment account — configurable because that binding is on Mi Billetera's
    // side (MIBI_CURRENCY).
    const currency =
      this.configService.get<MibiConfig>('mibi')?.currency ?? 'USD';

    const data = await this.mibiClient.createCharge({
      method: 'CRYPTO',
      amount: Number(order.total).toFixed(2),
      currency,
      description: `Orden ${order.orderNumber ?? order.id}`,
      idempotency_key: `order_${order.orderNumber ?? order.id}_crypto_${attempt}`,
      metadata: { order_id: order.id },
    });

    const charge = await this.chargeRepository.save(
      this.chargeRepository.create({
        orderId: order.id,
        reference: data.reference,
        idempotencyKey: `order_${order.orderNumber ?? order.id}_crypto_${attempt}`,
        ...this.gatewayFields(data),
      }),
    );

    order.paymentRef = data.reference;
    await this.orderRepository.save(order);
    return charge;
  }

  // Polling passthrough: refresh a non-terminal charge from the gateway and
  // propagate any terminal outcome to the order. Terminal charges are returned
  // as-is (nothing left to ask the gateway).
  async syncCharge(charge: PaymentCharge): Promise<PaymentCharge> {
    if (TERMINAL_CHARGE_STATUSES.includes(charge.status)) {
      return charge;
    }
    const data = await this.mibiClient.getCharge(charge.reference);
    Object.assign(charge, this.gatewayFields(data));
    await this.chargeRepository.save(charge);
    await this.propagateToOrder(charge);
    return charge;
  }

  // ---------------- Storefront flows (ownership-checked) ----------------

  async getChargeForClient(
    clientId: string,
    orderId: string,
  ): Promise<PaymentCharge> {
    await this.findClientOrder(clientId, orderId);
    const charge = await this.latestChargeFor(orderId);
    if (!charge) {
      throw new NotFoundException('This order has no payment attempt yet');
    }
    return this.syncCharge(charge);
  }

  // New attempt: allowed only while the order still needs paying and no live
  // charge exists (the previous one expired, failed, was cancelled — or
  // checkout-time creation failed entirely).
  async createChargeForClient(
    clientId: string,
    orderId: string,
  ): Promise<PaymentCharge> {
    const order = await this.findClientOrder(clientId, orderId);
    if (order.paymentStatus === PaymentStatus.PAID) {
      throw new BadRequestException('Order is already paid');
    }

    const latest = await this.latestChargeFor(orderId);
    if (latest) {
      // Refresh first: a stale REQUIRES_ACTION may already be terminal.
      const synced = await this.syncCharge(latest);
      if (this.isLive(synced)) {
        return synced; // reuse the live attempt instead of stacking charges
      }
    }
    return this.createChargeForOrder(order);
  }

  private async findClientOrder(
    clientId: string,
    orderId: string,
  ): Promise<Order> {
    const order = await this.orderRepository.findOne({
      where: { id: orderId, clientId },
    });
    if (!order) {
      throw new NotFoundException(`Order with id "${orderId}" not found`);
    }
    return order;
  }

  // ---------------- Webhook ----------------

  async handleWebhook(
    rawBody: string,
    headers: Record<string, string | string[] | undefined>,
  ): Promise<{ processed: boolean }> {
    this.verifySignature(rawBody, headers);

    let event: MibiWebhookEvent;
    try {
      event = JSON.parse(rawBody) as MibiWebhookEvent;
    } catch {
      throw new BadRequestException('Invalid JSON webhook payload');
    }

    const charge = await this.chargeRepository.findOne({
      where: { reference: event.reference },
    });
    if (!charge) {
      // 2xx anyway (controller): don't make the gateway retry a reference we
      // will never know.
      this.logger.warn(`Webhook for unknown charge "${event.reference}"`);
      return { processed: false };
    }

    // Idempotent: re-delivery of an already-applied terminal event is a no-op.
    if (
      TERMINAL_CHARGE_STATUSES.includes(charge.status) &&
      charge.status === (event.status as ChargeStatus)
    ) {
      return { processed: true };
    }

    charge.status = event.status as ChargeStatus;
    charge.lastPayload = event;
    if (typeof event.fee_amount === 'string')
      charge.feeAmount = event.fee_amount;
    if (typeof event.net_amount === 'string') {
      charge.settlementAmount = event.net_amount;
    }
    if (TERMINAL_CHARGE_STATUSES.includes(charge.status)) {
      charge.completedAt = new Date();
    }
    await this.chargeRepository.save(charge);
    await this.propagateToOrder(charge);
    return { processed: true };
  }

  // HMAC-SHA256 over the RAW body, hex digest in X-Mibi-Signature. Missing
  // secret: hard failure in production, bypass with a warning in dev/test
  // (same policy as the Clerk webhooks).
  private verifySignature(
    rawBody: string,
    headers: Record<string, string | string[] | undefined>,
  ): void {
    const secret = this.configService.get<MibiConfig>('mibi')?.webhookSecret;
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

  // ---------------- Internal helpers ----------------

  // Order payment status follows the charge, with one hard rule: never
  // downgrade a paid order. EXPIRED/CANCELLED leave the order pending so the
  // customer can start a new attempt.
  private async propagateToOrder(charge: PaymentCharge): Promise<void> {
    const order = await this.orderRepository.findOne({
      where: { id: charge.orderId },
    });
    if (!order || order.paymentStatus === PaymentStatus.PAID) return;

    if (charge.status === ChargeStatus.SUCCEEDED) {
      order.paymentStatus = PaymentStatus.PAID;
    } else if (charge.status === ChargeStatus.FAILED) {
      order.paymentStatus = PaymentStatus.FAILED;
    } else {
      return;
    }
    await this.orderRepository.save(order);
  }

  private gatewayFields(data: MibiChargeData): Partial<PaymentCharge> {
    return {
      status: data.status as ChargeStatus,
      amount: data.amount,
      feeAmount: data.fee_amount ?? null,
      settlementAmount: data.settlement_amount ?? data.net_amount ?? null,
      currency: data.currency,
      actionPayload: data.action_payload ?? null,
      lastPayload: data,
      errorMessage: data.error_message || null,
      expiresAt: data.expires_at ? new Date(data.expires_at) : null,
      completedAt: data.completed_at ? new Date(data.completed_at) : null,
    };
  }
}
