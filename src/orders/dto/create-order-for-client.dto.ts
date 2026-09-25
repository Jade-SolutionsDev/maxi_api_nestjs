import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { CheckoutContactDto } from './checkout.dto';
import { OrderLineDto } from './update-order-items.dto';
import { FulfillmentType } from '../entities/order.entity';

/**
 * Un cobro que ya ocurrió fuera del sistema: una transferencia, o efectivo en
 * el mostrador. No abre ningún intento de pago; solo deja constancia.
 */
export class CobroYaHechoDto {
  /** Código del método por el que se cobró (ver GET /payment-methods). */
  @IsString()
  @IsNotEmpty()
  @MaxLength(32)
  paymentMethod: string;

  /** Referencia de la transferencia, número de recibo… Va al historial. */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  reference?: string;
}

/**
 * Un pedido que hace un empleado en nombre de un cliente, para quien compra por
 * WhatsApp o por teléfono.
 *
 * Deliberadamente **no** acepta `addressId`: el panel manda la dirección
 * escrita, porque quien atiende el teléfono la está oyendo, no eligiéndola de
 * la libreta del cliente.
 */
export class CreateOrderForClientDto {
  /** El cliente a cuyo nombre va el pedido. Obligatorio siempre. */
  @IsUUID()
  clientId: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => OrderLineDto)
  items: OrderLineDto[];

  @IsOptional()
  @IsEnum(FulfillmentType)
  fulfillmentType?: FulfillmentType;

  @IsOptional()
  @IsUUID()
  deliveryOptionId?: string;

  @IsOptional()
  @IsUUID()
  pickupAddressId?: string;

  @IsOptional()
  @IsObject()
  deliveryAddress?: Record<string, unknown>;

  @IsOptional()
  @IsUUID()
  deliveryMunicipalityId?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => CheckoutContactDto)
  contact?: CheckoutContactDto;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  paymentMethod?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  customerNotes?: string;

  /** Presente solo si ya se cobró por fuera. Exige el permiso de cobros. */
  @IsOptional()
  @ValidateNested()
  @Type(() => CobroYaHechoDto)
  cobro?: CobroYaHechoDto;
}
