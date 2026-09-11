import { IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Lo que el cliente dice haber pagado. En un método manual no hay pasarela que
 * confirme nada: este dato es lo único con lo que alguien puede casar el pago
 * con el pedido — el nro. de transferencia, el de Transfermóvil o el hash de la
 * transacción.
 */
export class SubmitPaymentProofDto {
  @IsString()
  @MinLength(3)
  @MaxLength(200)
  reference: string;
}
