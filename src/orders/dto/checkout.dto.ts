import {
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

export class CheckoutDto {
  /** Municipality the order ships to (geography catalog id). */
  @IsOptional()
  @IsUUID()
  deliveryMunicipalityId?: string;

  /** Free-form address payload (street, number, references, ...). */
  @IsOptional()
  @IsObject()
  deliveryAddress?: Record<string, unknown>;

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
