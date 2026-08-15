import { IsOptional, IsUUID } from 'class-validator';

/**
 * Optional delivery-area scope for GET /public/products/:id. Same precedence
 * as the list endpoint: locationId > municipalityId > provinceId; omitted →
 * global sellable stock.
 */
export class PublicProductDetailQueryDto {
  /** Stock at this storage only. */
  @IsOptional()
  @IsUUID()
  locationId?: string;

  /** Delivery municipality. Takes precedence over `provinceId`. */
  @IsOptional()
  @IsUUID()
  municipalityId?: string;

  /** Whole-province browsing; ignored when `municipalityId` is set. */
  @IsOptional()
  @IsUUID()
  provinceId?: string;
}
