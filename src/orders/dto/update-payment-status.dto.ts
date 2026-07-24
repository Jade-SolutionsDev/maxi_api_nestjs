import { IsEnum } from 'class-validator';
import { PaymentStatus } from '../entities/order.entity';

export class UpdatePaymentStatusDto {
  @IsEnum(PaymentStatus)
  paymentStatus: PaymentStatus;
}
