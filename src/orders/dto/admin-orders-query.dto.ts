import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';
import { toOptionalBoolean } from '../../common/dto/query-transforms';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';
import { OrderStatus, PaymentStatus } from '../entities/order.entity';

/** Pedidos que no llegaron a tener ningún intento de pago. */
export const SIN_METODO_DE_PAGO = 'none';

export class AdminOrdersQueryDto extends PaginationQueryDto {
  /** Matches order number, client name or client email (ILIKE). */
  @IsOptional()
  @IsString()
  q?: string;

  /**
   * Código de la pasarela del **último** intento de pago —el mismo criterio con
   * el que el listado ya muestra el método, para que filtro y columna nunca se
   * contradigan en pantalla—, o `none` para los pedidos sin ningún intento, que
   * son uno de cada diez y si no se quedarían fuera de todo filtro.
   *
   * No se valida contra una lista cerrada a propósito: las pasarelas viven en
   * `payment_methods`, y un código desconocido devuelve cero filas en vez de un
   * 400 sobre un catálogo que puede crecer sin tocar este DTO.
   */
  @IsOptional()
  @IsString()
  paymentMethod?: string;

  @IsOptional()
  @IsEnum(OrderStatus)
  status?: OrderStatus;

  @IsOptional()
  @IsEnum(PaymentStatus)
  paymentStatus?: PaymentStatus;

  /** Comma-separated ids (react-admin getMany). */
  @IsOptional()
  @IsString()
  id?: string;

  /** All orders of one customer (admin client-detail view). */
  @IsOptional()
  @IsUUID()
  clientId?: string;

  /** Pickup orders holding reserved stock away from their pickup storage. */
  @IsOptional()
  @Transform(toOptionalBoolean)
  @IsBoolean()
  needsTransfer?: boolean;
}
