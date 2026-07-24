import { IsObject, IsOptional, IsString, IsUUID } from 'class-validator';

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
}
