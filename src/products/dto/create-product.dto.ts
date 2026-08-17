import {
  IsBoolean,
  IsDateString,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateProductDto {
  @IsUUID()
  categoryId: string;

  // Optional: auto-generated from the name when omitted.
  @IsOptional()
  @IsString()
  @Length(1, 100)
  sku?: string;

  @IsString()
  @IsNotEmpty()
  @Length(1, 255)
  name: string;

  @IsOptional()
  @IsString()
  @Length(1, 255)
  slug?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(2048)
  imageUrl: string;

  @IsOptional()
  @IsString()
  @Length(1, 100)
  format?: string;

  @IsOptional()
  @IsDateString()
  expiryDate?: string;

  @IsOptional()
  @IsString()
  @Length(1, 50)
  measureUnit?: string;

  @IsNumber()
  @Min(0)
  basePrice: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  discount?: number;

  @IsOptional()
  @IsBoolean()
  featured?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
