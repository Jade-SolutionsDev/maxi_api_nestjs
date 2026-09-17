import {
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { OrderStatus, PaymentStatus } from '../entities/order.entity';

/**
 * Corrección de superadministrador: cualquier estado de pedido y de pago, en
 * cualquier dirección. Al menos uno de los dos; el motivo siempre.
 */
export class CorrectOrderDto {
  @IsOptional()
  @IsEnum(OrderStatus)
  status?: OrderStatus;

  @IsOptional()
  @IsEnum(PaymentStatus)
  paymentStatus?: PaymentStatus;

  /** Por qué se corrige. Va al historial tal cual. */
  @IsString()
  @MinLength(5)
  @MaxLength(500)
  reason: string;
}

export class RemovePaymentAttemptDto {
  /** Por qué se quita el intento. Va al historial tal cual. */
  @IsString()
  @MinLength(5)
  @MaxLength(500)
  reason: string;
}
