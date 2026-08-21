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

  static fromEntity(
    method: PaymentMethod,
    kind: PaymentActionKind,
  ): StorefrontPaymentMethodDto {
    const dto = new StorefrontPaymentMethodDto();
    dto.code = method.code;
    dto.label = method.label;
    dto.description = method.description;
    dto.icon = method.icon;
    dto.kind = kind;
    return dto;
  }
}

/** How an order was paid, for list rows that only need to name the method. */
export class OrderPaymentMethodDto {
  code: string;
  label: string;
}
