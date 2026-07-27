import { IsNotEmpty, IsOptional, IsString, Length } from 'class-validator';

export class PickupAddressItemDto {
  // Optional short name for the pickup point (e.g. "Puerta principal").
  @IsOptional()
  @IsString()
  @Length(1, 100)
  label?: string;

  @IsString()
  @IsNotEmpty()
  @Length(1, 300)
  address: string;
}
