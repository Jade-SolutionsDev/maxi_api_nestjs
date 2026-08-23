import { BadRequestException, Injectable } from '@nestjs/common';
import { Order } from '../../../orders/entities/order.entity';
import {
  ChargeStatus,
  PaymentCharge,
} from '../../entities/payment-charge.entity';
import {
  GatewayCharge,
  GatewayWebhookEvent,
  PaymentActionKind,
  PaymentGateway,
} from '../../payment-gateway.interface';

/**
 * Always-available fallback: no platform is contacted, the attempt stays
 * pending and an admin settles it via PATCH /orders/:id/payment-status. Also
 * what a customer gets when every gateway is disabled or unreachable.
 */
@Injectable()
export class ManualGateway extends PaymentGateway {
  readonly code = 'manual';
  readonly kind: PaymentActionKind = 'manual';

  get configured(): boolean {
    return true;
  }

  createCharge(order: Order, idempotencyKey: string): Promise<GatewayCharge> {
    return Promise.resolve({
      reference: idempotencyKey,
      status: ChargeStatus.PENDING,
      amount: Number(order.total).toFixed(2),
      currency: 'USD',
      rawPayload: { manual: true },
    });
  }

  // Nothing to ask: an admin is the only thing that moves a manual charge, so
  // polling echoes what we already stored.
  syncCharge(charge: PaymentCharge): Promise<GatewayCharge> {
    return Promise.resolve({
      reference: charge.reference,
      status: charge.status,
      amount: charge.amount,
      currency: charge.currency,
      rawPayload: charge.lastPayload ?? { manual: true },
    });
  }

  parseWebhook(): GatewayWebhookEvent {
    throw new BadRequestException('Manual payments receive no webhooks');
  }
}
