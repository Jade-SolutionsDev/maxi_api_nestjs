import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';
import {
  toOptionalBoolean,
  toOptionalNumber,
  toSortOrder,
} from '../../common/dto/query-transforms';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

export class PublicProductsQueryDto extends PaginationQueryDto {
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

  /**
   * Delivery municipality. Returns products deliverable here: stock summed
   * across every storage that covers this municipality or its whole province
   * (the province is derived from the municipality). Takes precedence over
   * `provinceId`.
   */
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  municipalityId?: string;

  /**
   * Browse a whole province: stock across storages with province-wide coverage
   * of it. Ignored when `municipalityId` is set.
   */
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  provinceId?: string;

  /** Minimum final (discounted) price, inclusive. */
  @IsOptional()
  @Transform(toOptionalNumber)
  @IsNumber()
  @Min(0)
  minPrice?: number;

  /** Maximum final (discounted) price, inclusive. */
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

  // page + limit are inherited from PaginationQueryDto.

  /**
   * Sort field. Omitted → catalog order (curated `sortOrder`, then newest).
   * `price` sorts by list price. For a "recent" section use `createdAt` + `desc`.
   */
  @ApiPropertyOptional({
    enum: ['name', 'price', 'finalPrice', 'createdAt', 'updatedAt'],
    description:
      'Sort field. Omitted → catalog order (curated order, then newest). ' +
      '`price` = list price; `finalPrice` = discounted price.',
  })
  @IsOptional()
  @IsIn(['name', 'price', 'finalPrice', 'createdAt', 'updatedAt'])
  sortBy?: 'name' | 'price' | 'finalPrice' | 'createdAt' | 'updatedAt';

  /** Sort direction (default `asc`). */
  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'asc' })
  @IsOptional()
  @Transform(toSortOrder)
  @IsIn(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc';
}
