import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';
import {
  toOptionalBoolean,
  toOptionalNumber,
} from '../../common/dto/query-transforms';

export class PublicProductsQueryDto {
  /** Full-text match on the product name. */
  @IsOptional()
  @IsString()
  q?: string;

  /** Restrict to products in this category. */
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  /** Restrict to products whose category belongs to this department. */
  @IsOptional()
  @IsUUID()
  departmentId?: string;

  /**
   * Restrict to products stocked at this storage. When set, the returned
   * `amount`/`available` reflect the stock at this location instead of the total.
   */
  @IsOptional()
  @IsUUID()
  locationId?: string;

  /** Minimum base price (inclusive). */
  @IsOptional()
  @Transform(toOptionalNumber)
  @IsNumber()
  @Min(0)
  minPrice?: number;

  /** Maximum base price (inclusive). */
  @IsOptional()
  @Transform(toOptionalNumber)
  @IsNumber()
  @Min(0)
  maxPrice?: number;

  /** Only products flagged as featured. */
  @IsOptional()
  @Transform(toOptionalBoolean)
  @IsBoolean()
  featured?: boolean;

  /** Include products with zero stock (default false → only in-stock). */
  @IsOptional()
  @Transform(toOptionalBoolean)
  @IsBoolean()
  includeOutOfStock?: boolean;

  /** Cap the number of products returned (e.g. featured / recent sections). */
  @IsOptional()
  @Transform(toOptionalNumber)
  @IsNumber()
  @Min(1)
  limit?: number;
}
