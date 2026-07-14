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

export class UpdateStockLocationDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @Length(1, 150)
  name?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  // When provided, replaces the whole coverage set.
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CoverageItemDto)
  coverage?: CoverageItemDto[];

  // When provided (admins only), replaces the whole grocer assignment set.
  @IsOptional()
  @IsArray()
  @IsUUID('all', { each: true })
  grocerIds?: string[];
}
