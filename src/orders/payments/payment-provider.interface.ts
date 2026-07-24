import { Order, PaymentStatus } from '../entities/order.entity';

export interface PaymentInitiation {
  status: PaymentStatus;
  /** Gateway reference id, when the provider creates one. */
  ref?: string;
  /** Where to send the customer to pay (hosted checkout), when applicable. */
  redirectUrl?: string;
}

// Seam for the (undecided) payment platform, mirroring the AUTH_PROVIDER
// pattern. Today only ManualPaymentProvider exists: payments stay `pending`
// until an admin marks them. A real gateway later implements initiatePayment
// (create checkout session, return ref + redirectUrl) plus its own webhook.
export abstract class PaymentProvider {
  abstract initiatePayment(order: Order): Promise<PaymentInitiation>;
}

export const PAYMENT_PROVIDER = 'PAYMENT_PROVIDER';
