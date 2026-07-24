import { Injectable } from '@nestjs/common';
import { PaymentStatus } from '../entities/order.entity';
import {
  PaymentInitiation,
  PaymentProvider,
} from './payment-provider.interface';

// No payment platform yet: every order starts pending and an admin settles it
// via PATCH /orders/:id/payment-status.
@Injectable()
export class ManualPaymentProvider extends PaymentProvider {
  initiatePayment(): Promise<PaymentInitiation> {
    return Promise.resolve({ status: PaymentStatus.PENDING });
  }
}
