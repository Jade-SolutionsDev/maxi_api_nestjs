import { Transform } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { toOptionalNumber } from './query-transforms';

/** Hard ceiling on how many rows a single public page may request. */
export const MAX_PAGE_LIMIT = 100;

/** Shared page/limit query params for paginated public list endpoints. */
export class PaginationQueryDto {
  /** 1-based page number (default 1). Applies only when `limit` is set. */
  @IsOptional()
  @Transform(toOptionalNumber)
  @IsInt()
  @Min(1)
  page?: number;

  /** Page size. Omit to return all matching rows on a single page. */
  @IsOptional()
  @Transform(toOptionalNumber)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_LIMIT)
  limit?: number;
}
