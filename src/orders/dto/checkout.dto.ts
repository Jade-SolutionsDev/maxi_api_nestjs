import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { CreateClientAddressDto } from '../../client-addresses/dto/create-client-address.dto';
import { FulfillmentType } from '../entities/order.entity';

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
