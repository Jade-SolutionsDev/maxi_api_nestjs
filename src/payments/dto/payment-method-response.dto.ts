import { PaymentMethod } from '../entities/payment-method.entity';
import type { PaymentActionKind } from '../payment-gateway.interface';

/** Admin view of a catalog entry. */
export class PaymentMethodResponseDto {
  id: string;
  code: string;
  label: string;
  description: string | null;
  icon: string | null;
  sortOrder: number;
  enabled: boolean;
  config: Record<string, unknown> | null;
  /** Credentials present in this environment. False ⇒ the method cannot be enabled. */
  configured: boolean;
  kind: PaymentActionKind;
  createdAt: Date;
  updatedAt: Date;

  static fromEntity(
    method: PaymentMethod,
    configured: boolean,
    kind: PaymentActionKind,
  ): PaymentMethodResponseDto {
    const dto = new PaymentMethodResponseDto();
    dto.id = method.id;
    dto.code = method.code;
    dto.label = method.label;
    dto.description = method.description;
    dto.icon = method.icon;
    dto.sortOrder = method.sortOrder;
    dto.enabled = method.enabled;
    dto.config = method.config;
    dto.configured = configured;
    dto.kind = kind;
    dto.createdAt = method.createdAt;
    dto.updatedAt = method.updatedAt;
    return dto;
  }
}

/** What the storefront needs to render the method picker. */
export class StorefrontPaymentMethodDto {
  code: string;
  label: string;
  description: string | null;
  icon: string | null;
  kind: PaymentActionKind;
  /**
   * Minutes the order keeps its stock reserved with this method before the
   * expiry sweep cancels it. It travels with the method because the checkout
   * has to say it BEFORE the order exists, when there is no charge yet to read
   * an `expiresAt` from — and hardcoding it in the storefront would drift the
   * day someone changes ORDER_EXPIRY_GATEWAY_MINUTES.
   */
  holdMinutes: number;

  static fromEntity(
    method: PaymentMethod,
    kind: PaymentActionKind,
    holdMinutes: number,
  ): StorefrontPaymentMethodDto {
    const dto = new StorefrontPaymentMethodDto();
    dto.code = method.code;
    dto.label = method.label;
    dto.description = method.description;
    dto.icon = method.icon;
    dto.kind = kind;
    dto.holdMinutes = holdMinutes;
    return dto;
  }
}

/** How an order was paid, for list rows that only need to name the method. */
export class OrderPaymentMethodDto {
  code: string;
  label: string;
}
