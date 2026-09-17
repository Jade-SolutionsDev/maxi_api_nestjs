import {
  IsEnum,
  IsNumberString,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Refund, RefundMethod, RefundStatus } from '../entities/refund.entity';

/**
 * Solicitar una devolución. El importe es opcional: sin él se devuelve todo lo
 * que quede pendiente, que es el caso corriente.
 */
export class CreateRefundDto {
  /** Importe en USD, con dos decimales. Omitir para devolver lo pendiente. */
  @IsOptional()
  @IsNumberString({ no_symbols: false })
  amount?: string;

  /** Por qué se devuelve. Va al historial y a la cola tal cual. */
  @IsString()
  @MinLength(5)
  @MaxLength(500)
  reason: string;

  @IsOptional()
  @IsEnum(RefundMethod)
  method?: RefundMethod;

  /** Dirección USDT (BEP20) o referencia, si ya se la pediste al cliente. */
  @IsOptional()
  @IsString()
  @MaxLength(255)
  destination?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}

/** Confirmar que el dinero salió. Esto es lo que mueve el pedido a «reembolsado». */
export class CompleteRefundDto {
  /** A dónde se envió. Obligatorio en los reembolsos manuales. */
  @IsOptional()
  @IsString()
  @MaxLength(255)
  destination?: string;

  /** Hash de la transacción o referencia del movimiento. */
  @IsOptional()
  @IsString()
  @MaxLength(255)
  providerRef?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}

export class RejectRefundDto {
  /** Por qué no procede. Queda escrito en la ficha. */
  @IsString()
  @MinLength(5)
  @MaxLength(500)
  reason: string;
}

/** Una devolución tal como la ve la administración. */
export class RefundResponseDto {
  id: string;
  orderId: string;
  /** Número del pedido, para la cola: ORD-20262440. */
  orderNumber: string | null;
  clientName: string | null;
  clientEmail: string | null;
  /** Total cobrado del pedido, para comparar con lo que se devuelve. */
  orderTotal: string | null;
  /**
   * Marca los pedidos que se pagaron tarde y ya no tenían mercancía: el dinero
   * entró y no hay contrapartida, así que son los urgentes de la cola.
   */
  paidAfterExpiryOutOfStock: boolean;
  amount: string;
  currency: string;
  status: RefundStatus;
  method: RefundMethod;
  origin: string;
  reason: string;
  destination: string | null;
  providerRef: string | null;
  notes: string | null;
  requestedBy: string | null;
  requestedByName: string | null;
  requestedAt: Date;
  completedBy: string | null;
  completedByName: string | null;
  completedAt: Date | null;
  rejectedAt: Date | null;
  rejectionReason: string | null;

  static fromEntity(refund: Refund): RefundResponseDto {
    const dto = new RefundResponseDto();
    dto.id = refund.id;
    dto.orderId = refund.orderId;
    dto.orderNumber = null;
    dto.clientName = null;
    dto.clientEmail = null;
    dto.orderTotal = null;
    dto.paidAfterExpiryOutOfStock = false;
    dto.amount = refund.amount;
    dto.currency = refund.currency;
    dto.status = refund.status;
    dto.method = refund.method;
    dto.origin = refund.origin;
    dto.reason = refund.reason;
    dto.destination = refund.destination;
    dto.providerRef = refund.providerRef;
    dto.notes = refund.notes;
    dto.requestedBy = refund.requestedBy;
    dto.requestedByName = null;
    dto.requestedAt = refund.requestedAt;
    dto.completedBy = refund.completedBy;
    dto.completedByName = null;
    dto.completedAt = refund.completedAt;
    dto.rejectedAt = refund.rejectedAt;
    dto.rejectionReason = refund.rejectionReason;
    return dto;
  }
}
