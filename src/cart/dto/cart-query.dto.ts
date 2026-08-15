import { IsOptional, IsUUID } from 'class-validator';

/**
 * Optional delivery-area scope shared by every cart route. When set, line
 * `available`/`isAvailable` and the add/update stock validation are computed
 * against the storages covering that municipality; omitted → global stock
 * (what `orders.service.checkout()` relies on internally).
 */
export class CartQueryDto {
  @IsOptional()
  @IsUUID()
  municipalityId?: string;
}
