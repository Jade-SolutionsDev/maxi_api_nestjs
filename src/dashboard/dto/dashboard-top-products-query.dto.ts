import { Transform } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import { toOptionalNumber } from '../../common/dto/query-transforms';

export class DashboardTopProductsQueryDto {
  /**
   * Window length in days. Same whitelist as the KPI endpoint so both widgets
   * on the page can be driven by one selector and always agree on the period.
   */
  @IsOptional()
  @Transform(toOptionalNumber)
  @IsIn([7, 30, 90])
  days?: number = 30;

  /**
   * How many products to rank. Bounded because the aggregate has to sort every
   * grouped product before it can take the top N — an unbounded limit from a
   * query string would let a caller pull the whole catalogue.
   */
  @IsOptional()
  @Transform(toOptionalNumber)
  @IsInt()
  @Min(1)
  @Max(20)
  limit?: number = 5;
}
