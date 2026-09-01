import { ApiProperty } from '@nestjs/swagger';
import type { PaymentActionKind } from '../payment-gateway.interface';
import { PaymentCharge } from '../entities/payment-charge.entity';

/**
 * Customer/admin view of a payment attempt, shared by every gateway. Clients
 * branch on `kind`, never on `provider`: `redirect` renders a "pay now" link,
 * `instructions` renders the deposit data from the gateway's action payload
 * (token/blockchain are whatever the platform is configured for — never
 * hardcode a network), `manual` means an admin settles it by hand.
 */
export class PaymentChargeResponseDto {
  /** Gateway code, e.g. "tropipay" | "mibilletera" | "manual". */
  provider: string;

  @ApiProperty({ enum: ['redirect', 'instructions', 'manual'] })
  kind: PaymentActionKind;

  /** Gateway reference — quote it in any support conversation. */
  reference: string;

  /** PENDING | REQUIRES_ACTION | PROCESSING | SUCCEEDED | FAILED | EXPIRED | CANCELLED. */
  status: string;

  /** Hosted checkout URL; send the customer here (redirect gateways). */
  redirectUrl: string | null;

  /** Address the customer must send the funds to (instructions gateways). */
  depositAddress: string | null;

  /** EXACT amount the customer must send. */
  amount: string | null;

  /** Token symbol (e.g. "usdt"), when the gateway settles in crypto. */
  token: string | null;

  /** Network the customer must use (e.g. "BEP20") — always display it. */
  blockchain: string | null;

  /** Wallet payment-request number (e.g. "PR-…") the customer can look up in the app. */
  operationNumber: string | null;

  /** Opaque payload for rendering the payment-request QR (wallet charges). */
  qrData: Record<string, unknown> | null;

  /** Settlement currency of the attempt. */
  currency: string | null;

  /** Action deadline; hide/expire the payment screen when reached. Null = no deadline. */
  expiresAt: Date | null;

  /** Fee charged by the gateway (admin reconciliation). */
  feeAmount: string | null;

  /** Net amount settled to the merchant account (admin reconciliation). */
  settlementAmount: string | null;

  errorMessage: string | null;
  createdAt: Date;

  static fromEntity(
    charge: PaymentCharge,
    kind: PaymentActionKind,
  ): PaymentChargeResponseDto {
    const dto = new PaymentChargeResponseDto();
    const action = charge.actionPayload ?? {};
    dto.provider = charge.provider;
    dto.kind = kind;
    dto.reference = charge.reference;
    dto.status = charge.status;
    dto.redirectUrl = charge.redirectUrl;
    dto.depositAddress = (action.deposit_address as string) ?? null;
    dto.amount = (action.amount as string) ?? charge.amount ?? null;
    dto.token = (action.token as string) ?? null;
    dto.blockchain = (action.blockchain as string) ?? null;
    dto.operationNumber = (action.operation_number as string) ?? null;
    dto.qrData = (action.qr_data as Record<string, unknown>) ?? null;
    dto.currency = charge.currency ?? null;
    dto.expiresAt = charge.expiresAt;
    dto.feeAmount = charge.feeAmount;
    dto.settlementAmount = charge.settlementAmount;
    dto.errorMessage = charge.errorMessage;
    dto.createdAt = charge.createdAt;
    return dto;
  }
}
