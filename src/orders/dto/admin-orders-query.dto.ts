import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsNumberString,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';
import { toOptionalBoolean } from '../../common/dto/query-transforms';

/**
 * Una cadena vacía es «sin filtro», no un valor a validar.
 *
 * `@IsOptional()` solo perdona lo ausente: un formulario que manda `from: ''`
 * —porque el campo se dejó en blanco— hacía que `@IsDateString` rechazara el
 * cuerpo entero y la petición muriera con un 400 que nadie veía. Le pasó al
 * envío del reporte por correo el 25-sep.
 */
const vacioEsNada = ({ value }: { value: unknown }) =>
  typeof value === 'string' && value.trim() === '' ? undefined : value;
import { PaginationQueryDto } from '../../common/dto/pagination.dto';
import {
  FulfillmentType,
  OrderStatus,
  PaymentStatus,
} from '../entities/order.entity';

/** Pedidos que no llegaron a tener ningún intento de pago. */
export const SIN_METODO_DE_PAGO = 'none';

export class AdminOrdersQueryDto extends PaginationQueryDto {
  /** Matches order number or client name, email or phone (accent-insensitive). */
  @IsOptional()
  @Transform(vacioEsNada)
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
  @Transform(vacioEsNada)
  @IsString()
  paymentMethod?: string;

  @IsOptional()
  @Transform(vacioEsNada)
  @IsEnum(OrderStatus)
  status?: OrderStatus;

  @IsOptional()
  @Transform(vacioEsNada)
  @IsEnum(PaymentStatus)
  paymentStatus?: PaymentStatus;

  /** Comma-separated ids (react-admin getMany). */
  @IsOptional()
  @Transform(vacioEsNada)
  @IsString()
  id?: string;

  /** All orders of one customer (admin client-detail view). */
  @IsOptional()
  @Transform(vacioEsNada)
  @IsUUID()
  clientId?: string;

  /** Pickup orders holding reserved stock away from their pickup storage. */
  @IsOptional()
  @Transform(toOptionalBoolean)
  @IsBoolean()
  needsTransfer?: boolean;

  /**
   * Rango de fechas de creación, inclusivo por los dos lados. `to` se entiende
   * como el día entero: quien escribe «hasta el 24» espera que entren los
   * pedidos de esa tarde, no que se corten a medianoche del 23.
   *
   * Nacieron con el reporte (MxH-0120), pero valen igual para el listado: con
   * ciento cincuenta pedidos y subiendo, «los de esta semana» es la pregunta
   * más frecuente.
   */
  @IsOptional()
  @Transform(vacioEsNada)
  @IsDateString()
  from?: string;

  @IsOptional()
  @Transform(vacioEsNada)
  @IsDateString()
  to?: string;

  /** A domicilio o recogida en mostrador. */
  @IsOptional()
  @Transform(vacioEsNada)
  @IsEnum(FulfillmentType)
  fulfillmentType?: FulfillmentType;

  /** El mostrador donde se recoge: da a cada local su propio listado. */
  @IsOptional()
  @Transform(vacioEsNada)
  @IsUUID()
  pickupLocationId?: string;

  /**
   * Rango de importe del pedido, inclusivo. Llega como texto porque el total
   * es `decimal` y pasarlo por `number` perdería céntimos en los importes
   * grandes: la tienda vende en USD y hay pedidos de cinco cifras.
   */
  @IsOptional()
  @Transform(vacioEsNada)
  @IsNumberString()
  minTotal?: string;

  @IsOptional()
  @Transform(vacioEsNada)
  @IsNumberString()
  maxTotal?: string;
}
