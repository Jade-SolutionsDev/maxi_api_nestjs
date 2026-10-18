import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { CreateClientAddressDto } from '../../client-addresses/dto/create-client-address.dto';
import { IsCubanIdCard } from '../../common/decorators/is-cuban-id.decorator';
import { FulfillmentType } from '../entities/order.entity';

/**
 * Quién recibe el pedido. Hace falta también en las recogidas, donde no hay
 * dirección ninguna que pueda llevar estos datos: alguien tiene que poder
 * identificar en el mostrador a la persona que se lleva la mercancía.
 */
export class CheckoutContactDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  recipientName: string;

  @IsCubanIdCard()
  idCard: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  contactPhone: string;
}

export class CheckoutDto {
  /**
   * How the customer gets the order. Omitted ⇒ delivery when any option is
   * available, otherwise pickup — so a single-choice shop needs no picker.
   */
  @IsOptional()
  @IsEnum(FulfillmentType)
  fulfillmentType?: FulfillmentType;

  /** Required for delivery: one of GET /storefront/fulfillment's options. */
  @IsOptional()
  @IsUUID()
  deliveryOptionId?: string;

  /** Required for pickup: one of that same response's pickup points. */
  @IsOptional()
  @IsUUID()
  pickupAddressId?: string;

  /** A saved address of this customer. Wins over `address` when both arrive. */
  @IsOptional()
  @IsUUID()
  addressId?: string;

  /** A new address typed at checkout. */
  @IsOptional()
  @ValidateNested()
  @Type(() => CreateClientAddressDto)
  address?: CreateClientAddressDto;

  /**
   * Datos de quien recibe. Obligatorio en recogida; en entrega puede venir
   * dentro de `address`, y entonces este campo sobra.
   */
  @IsOptional()
  @ValidateNested()
  @Type(() => CheckoutContactDto)
  contact?: CheckoutContactDto;

  /** Keep `address` in the customer's address book. */
  @IsOptional()
  @IsBoolean()
  saveAddress?: boolean;

  /**
   * Legacy free-form address payload. Superseded by `addressId`/`address`;
   * still accepted so an older client keeps working.
   */
  @IsOptional()
  @IsObject()
  deliveryAddress?: Record<string, unknown>;

  /**
   * Clave del intento de compra, para que un reintento no cree otro pedido
   * (MxH-0176).
   *
   * La tienda corta a los 8 segundos y ese corte no detiene a la API: el
   * pedido puede haberse creado igual. Mandando la misma clave, el segundo
   * intento **devuelve el mismo pedido** en vez de uno nuevo.
   *
   * Opcional: un cliente antiguo que no la mande sigue funcionando como
   * siempre, sin protección pero sin romperse.
   */
  @IsOptional()
  @IsString()
  @Length(16, 64)
  @Matches(/^[A-Za-z0-9_-]+$/, {
    message: 'idempotencyKey solo admite letras, números, guion y guion bajo',
  })
  idempotencyKey?: string;

  /** Municipality the order ships to. Derived from the address when given. */
  @IsOptional()
  @IsUUID()
  deliveryMunicipalityId?: string;

  @IsOptional()
  @IsString()
  customerNotes?: string;

  /**
   * Payment method code (see GET /storefront/payment-methods). Omitted ⇒ the
   * first enabled method, so a single-gateway storefront needs no picker.
   */
  @IsOptional()
  @IsString()
  @MaxLength(32)
  paymentMethod?: string;
}
