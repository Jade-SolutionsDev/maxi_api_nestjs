import { PaymentCharge } from '../entities/payment-charge.entity';

// Customer/admin view of a payment attempt. The deposit instructions come
// EXCLUSIVELY from the gateway's action_payload — token and blockchain are
// whatever the platform is configured for (USDT/BEP20 today); never hardcode
// the network in a client.
export class PaymentChargeResponseDto {
  provider: string;
  /** Gateway reference — quote it in any support conversation. */
  reference: string;
  /** Gateway charge status: PENDING | REQUIRES_ACTION | PROCESSING | SUCCEEDED | FAILED | EXPIRED | CANCELLED. */
  status: string;
  /** Address the customer must send the funds to. */
  depositAddress: string | null;
  /** EXACT token amount the customer must send. */
  amount: string | null;
  /** Token symbol (e.g. "usdt"). */
  token: string | null;
  /** Network the customer must use (e.g. "BEP20") — always display it. */
  blockchain: string | null;
  /** Action deadline; hide/expire the payment screen when reached. */
  expiresAt: Date | null;
  /** Fee charged by the gateway (admin reconciliation). */
  feeAmount: string | null;
  /** Net amount settled to the merchant account (admin reconciliation). */
  settlementAmount: string | null;
  errorMessage: string | null;
  createdAt: Date;

  static fromEntity(charge: PaymentCharge): PaymentChargeResponseDto {
    const dto = new PaymentChargeResponseDto();
    const action = charge.actionPayload ?? {};
    dto.provider = 'mibilletera';
    dto.reference = charge.reference;
    dto.status = charge.status;
    dto.depositAddress = (action.deposit_address as string) ?? null;
    dto.amount = (action.amount as string) ?? charge.amount ?? null;
    dto.token = (action.token as string) ?? null;
    dto.blockchain = (action.blockchain as string) ?? null;
    dto.expiresAt = charge.expiresAt;
    dto.feeAmount = charge.feeAmount;
    dto.settlementAmount = charge.settlementAmount;
    dto.errorMessage = charge.errorMessage;
    dto.createdAt = charge.createdAt;
    return dto;
  }
}
