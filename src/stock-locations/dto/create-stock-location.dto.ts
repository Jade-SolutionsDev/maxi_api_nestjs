import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  ValidateNested,
} from 'class-validator';
import { CoverageItemDto } from './coverage-item.dto';
import { PickupAddressItemDto } from './pickup-address-item.dto';

export class CreateStockLocationDto {
  @IsString()
  @IsNotEmpty()
  @Length(1, 150)
  name: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CoverageItemDto)
  coverage: CoverageItemDto[];

  // Only honored for ADMIN/SUPER_ADMIN; stripped for grocers in the service.
  @IsOptional()
  @IsArray()
  @IsUUID('all', { each: true })
  grocerIds?: string[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PickupAddressItemDto)
  pickupAddresses?: PickupAddressItemDto[];
}
