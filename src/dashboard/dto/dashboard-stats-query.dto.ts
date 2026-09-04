import { Transform } from 'class-transformer';
import { IsIn, IsOptional } from 'class-validator';
import { toOptionalNumber } from '../../common/dto/query-transforms';

export class DashboardStatsQueryDto {
  /**
   * Window length in days. The response always carries the current window and
   * the one immediately before it, so the caller can render a trend.
   *
   * Constrained to a small set on purpose: an arbitrary number arriving from a
   * query string invites a scan of the whole orders table.
   */
  @IsOptional()
  @Transform(toOptionalNumber)
  @IsIn([7, 30, 90])
  days?: number = 30;
}
