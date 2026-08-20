import { Injectable } from '@nestjs/common';
import { Order, PaymentStatus } from '../entities/order.entity';
import { MibiPaymentService } from './mibi-payment.service';
import {
  PaymentInitiation,
  PaymentProvider,
} from './payment-provider.interface';

// The PAYMENT_PROVIDER seam bound when MIBI keys are configured: checkout
// creates a CRYPTO MerchantCharge. Payment stays `pending` until a webhook or
// poll reports SUCCEEDED — never on initiation.
@Injectable()
export class MibiPaymentProvider extends PaymentProvider {
  constructor(private readonly mibiPaymentService: MibiPaymentService) {
    super();
  }

  async initiatePayment(order: Order): Promise<PaymentInitiation> {
    const charge = await this.mibiPaymentService.createChargeForOrder(order);
    return { status: PaymentStatus.PENDING, ref: charge.reference };
  }
}
