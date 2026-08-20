import { Order } from '../orders/entities/order.entity';
import { ChargeStatus, PaymentCharge } from './entities/payment-charge.entity';

/**
 * How the customer completes the payment. The storefront branches on this and
 * never on the provider name, so a new gateway reuses an existing screen.
 */
export type PaymentActionKind = 'redirect' | 'instructions' | 'manual';

/**
 * A payment attempt as seen by the gateway, normalized. PaymentsService owns
 * persistence; a gateway only translates its own vocabulary into this shape.
 */
export interface GatewayCharge {
  reference: string;
  status: ChargeStatus;
  amount: string;
  currency: string;
  feeAmount?: string | null;
  settlementAmount?: string | null;
  /** Customer-facing action data (e.g. crypto deposit instructions). */
  actionPayload?: Record<string, unknown> | null;
  /** Hosted checkout the customer must be sent to. */
  redirectUrl?: string | null;
  expiresAt?: Date | null;
  completedAt?: Date | null;
  errorMessage?: string | null;
  /** Full gateway body, persisted for audit and reconciliation. */
  rawPayload: Record<string, unknown>;
}

/** A verified webhook event, reduced to the charge it moves. */
export interface GatewayWebhookEvent {
  reference: string;
  charge: Partial<GatewayCharge>;
}

/**
 * One payment platform. Everything provider-independent (attempt numbering,
 * idempotency keys, persistence, order propagation, ownership checks) lives in
 * PaymentsService — implementations stay thin on purpose.
 */
export abstract class PaymentGateway {
  /** Catalog key; matches payment_methods.code. */
  abstract readonly code: string;

  /** Customer-facing shape of the attempt. */
  abstract readonly kind: PaymentActionKind;

  /** Credentials present in the environment. A method cannot be enabled without this. */
  abstract get configured(): boolean;

  abstract createCharge(
    order: Order,
    idempotencyKey: string,
  ): Promise<GatewayCharge>;

  /** Refresh a non-terminal charge from the gateway. */
  abstract syncCharge(charge: PaymentCharge): Promise<GatewayCharge>;

  /**
   * Verify the signature over the RAW body and reduce the event. Throws
   * UnauthorizedException when the signature does not check out.
   */
  abstract parseWebhook(
    rawBody: string,
    headers: Record<string, string | string[] | undefined>,
  ): GatewayWebhookEvent;
}

export const PAYMENT_GATEWAYS = 'PAYMENT_GATEWAYS';
