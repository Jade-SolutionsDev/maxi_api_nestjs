import {
  BadGatewayException,
  BadRequestException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Order, PaymentStatus } from '../orders/entities/order.entity';
import { PaymentChargeResponseDto } from './dto/payment-charge-response.dto';
import {
  ChargeStatus,
  PaymentCharge,
  TERMINAL_CHARGE_STATUSES,
} from './entities/payment-charge.entity';
import { PaymentMethodsService } from './payment-methods.service';
import { GatewayCharge, PaymentGateway } from './payment-gateway.interface';

/**
 * Everything about a payment attempt that does not depend on which platform
 * runs it: attempt numbering and idempotency keys, persistence, ownership
 * checks, polling, webhook application and order propagation.
 *
 * Two rules drive the shape: an order is paid ONLY when its charge reaches
 * SUCCEEDED, and an expired/failed attempt is never reused — a retry is a NEW
 * charge with a NEW idempotency key.
 */
@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    @InjectRepository(PaymentCharge)
    private readonly chargeRepository: Repository<PaymentCharge>,
    @InjectRepository(Order)
    private readonly orderRepository: Repository<Order>,
    private readonly methodsService: PaymentMethodsService,
  ) {}

  /** Latest attempt of an order, if any (newest wins, whatever its provider). */
  latestChargeFor(orderId: string): Promise<PaymentCharge | null> {
    return this.chargeRepository.findOne({
      where: { orderId },
      order: { createdAt: 'DESC' },
    });
  }

  /** Latest attempt as a response DTO — undefined when the order has none. */
  async latestChargeDto(
    orderId: string,
  ): Promise<PaymentChargeResponseDto | undefined> {
    const charge = await this.latestChargeFor(orderId);
    if (!charge) return undefined;
    return PaymentChargeResponseDto.fromEntity(
      charge,
      this.methodsService.gatewayFor(charge.provider).kind,
    );
  }

  toDto(charge: PaymentCharge): PaymentChargeResponseDto {
    return PaymentChargeResponseDto.fromEntity(
      charge,
      this.methodsService.gatewayFor(charge.provider).kind,
    );
  }

  // A charge the customer can still act on: non-terminal and not past its
  // action window.
  private isLive(charge: PaymentCharge): boolean {
    return (
      !TERMINAL_CHARGE_STATUSES.includes(charge.status) &&
      (!charge.expiresAt || charge.expiresAt.getTime() > Date.now())
    );
  }

  /**
   * Creates the next payment attempt for an order. The idempotency key embeds
   * the attempt number so a retry after EXPIRED/FAILED never collides (gateways
   * reject a reused key carrying a different payload) — and it doubles as the
   * gateway reference for platforms that let us choose one.
   */
  async createChargeForOrder(
    order: Order,
    gateway: PaymentGateway,
  ): Promise<PaymentCharge> {
    const attempt =
      (await this.chargeRepository.count({ where: { orderId: order.id } })) + 1;
    const idempotencyKey = `order_${order.orderNumber ?? order.id}_${gateway.code}_${attempt}`;

    const data = await this.callGateway(gateway.code, () =>
      gateway.createCharge(order, idempotencyKey),
    );
    const charge = await this.chargeRepository.save(
      this.chargeRepository.create({
        orderId: order.id,
        provider: gateway.code,
        reference: data.reference,
        idempotencyKey,
        ...this.gatewayFields(data),
      }),
    );

    order.paymentRef = data.reference;
    await this.orderRepository.save(order);
    return charge;
  }

  /**
   * Refresh a non-terminal charge from its gateway and propagate any terminal
   * outcome to the order. Terminal charges are returned as-is — nothing left to
   * ask, and re-asking would race gateways whose transaction lists lag their
   * own webhooks.
   */
  async syncCharge(charge: PaymentCharge): Promise<PaymentCharge> {
    if (TERMINAL_CHARGE_STATUSES.includes(charge.status)) {
      return charge;
    }
    const gateway = this.methodsService.gatewayFor(charge.provider);
    const data = await this.callGateway(gateway.code, () =>
      gateway.syncCharge(charge),
    );
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

  /**
   * New attempt: allowed while the order still needs paying. A live attempt of
   * the SAME method is reused instead of stacking charges; asking for a
   * different method always starts a fresh one (the customer changed their
   * mind, and the abandoned link simply expires).
   */
  async createChargeForClient(
    clientId: string,
    orderId: string,
    method?: string,
  ): Promise<PaymentCharge> {
    const order = await this.findClientOrder(clientId, orderId);
    if (order.paymentStatus === PaymentStatus.PAID) {
      throw new BadRequestException('Order is already paid');
    }
    const gateway = await this.methodsService.resolve(method);

    const latest = await this.latestChargeFor(orderId);
    if (latest && latest.provider === gateway.code) {
      // Refresh first: a stale REQUIRES_ACTION may already be terminal.
      const synced = await this.syncCharge(latest);
      if (this.isLive(synced)) {
        return synced;
      }
    }
    return this.createChargeForOrder(order, gateway);
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

  // ---------------- Webhooks ----------------

  /**
   * Applies a signed gateway callback. The gateway verifies the signature and
   * reduces the body; everything after that is provider-independent.
   */
  async handleWebhook(
    provider: string,
    rawBody: string,
    headers: Record<string, string | string[] | undefined>,
  ): Promise<{ processed: boolean }> {
    const gateway = this.methodsService.gatewayFor(provider);
    const event = gateway.parseWebhook(rawBody, headers);

    const charge = event.reference
      ? await this.chargeRepository.findOne({
          where: { reference: event.reference, provider },
        })
      : null;
    if (!charge) {
      // 2xx anyway (controller): don't make the gateway retry a reference we
      // will never know.
      this.logger.warn(
        `Webhook for unknown ${provider} charge "${event.reference}"`,
      );
      return { processed: false };
    }

    // Idempotent: re-delivery of an already-applied terminal event is a no-op.
    if (
      TERMINAL_CHARGE_STATUSES.includes(charge.status) &&
      charge.status === event.charge.status
    ) {
      return { processed: true };
    }

    Object.assign(charge, this.gatewayFields(event.charge));
    if (
      TERMINAL_CHARGE_STATUSES.includes(charge.status) &&
      !charge.completedAt
    ) {
      charge.completedAt = new Date();
    }
    await this.chargeRepository.save(charge);
    await this.propagateToOrder(charge);
    return { processed: true };
  }

  // ---------------- Internal helpers ----------------

  /**
   * Order payment status follows the charge, with one hard rule: never
   * downgrade a paid order. EXPIRED/CANCELLED leave the order pending so the
   * customer can start a new attempt.
   */
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

  /**
   * A gateway that rejects us or is unreachable is a 502, not a 500: the
   * request was fine, the upstream was not. Clients key their "try again /
   * we'll settle it manually" copy off that. Our own validation errors
   * (unsupported currency, already paid) keep their own status.
   */
  private async callGateway<T>(
    code: string,
    call: () => Promise<T>,
  ): Promise<T> {
    try {
      return await call();
    } catch (err) {
      if (err instanceof HttpException) throw err;
      this.logger.error(
        `Gateway "${code}" call failed`,
        err instanceof Error ? err.stack : String(err),
      );
      throw new BadGatewayException(
        `Payment gateway "${code}" is unavailable right now`,
      );
    }
  }

  // Only the fields the gateway actually reported: a partial webhook event
  // must not blank out data the create response already gave us.
  private gatewayFields(data: Partial<GatewayCharge>): Partial<PaymentCharge> {
    const fields: Partial<PaymentCharge> = {};
    if (data.status !== undefined) fields.status = data.status;
    if (data.amount !== undefined) fields.amount = data.amount;
    if (data.currency !== undefined) fields.currency = data.currency;
    if (data.feeAmount !== undefined) fields.feeAmount = data.feeAmount ?? null;
    if (data.settlementAmount !== undefined) {
      fields.settlementAmount = data.settlementAmount ?? null;
    }
    if (data.actionPayload !== undefined) {
      fields.actionPayload = data.actionPayload ?? null;
    }
    if (data.redirectUrl !== undefined) {
      fields.redirectUrl = data.redirectUrl ?? null;
    }
    if (data.errorMessage !== undefined) {
      fields.errorMessage = data.errorMessage || null;
    }
    if (data.expiresAt !== undefined) fields.expiresAt = data.expiresAt ?? null;
    if (data.completedAt !== undefined) {
      fields.completedAt = data.completedAt ?? null;
    }
    if (data.rawPayload !== undefined) fields.lastPayload = data.rawPayload;
    return fields;
  }
}
