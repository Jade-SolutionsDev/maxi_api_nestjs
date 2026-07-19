import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsOptional, IsUUID } from 'class-validator';
import {
  toOptionalBoolean,
  toSortOrder,
} from '../../common/dto/query-transforms';

// Storefront endpoints already return only *valid* rows (active departments
// with in-stock categories / active categories with in-stock products), so no
// opt-in validity flag is needed — these DTOs only carry genuine facets.

// Storefront taxonomy sort. Default (omitted) → curated `sortOrder`, then name.
const SORT_FIELDS = ['name', 'sortOrder', 'createdAt'] as const;
type SortField = (typeof SORT_FIELDS)[number];

export class PublicDepartmentsQueryDto {
  /** Only departments flagged as featured. */
  @IsOptional()
  @Transform(toOptionalBoolean)
  @IsBoolean()
  featured?: boolean;

  /** Sort field (default: curated `sortOrder`, then name). */
  @IsOptional()
  @IsIn(SORT_FIELDS)
  sortBy?: SortField;

  /** Sort direction (default `asc`). */
  @IsOptional()
  @Transform(toSortOrder)
  @IsIn(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc';
}

export class PublicCategoriesQueryDto {
  /** Restrict to a single department (parent). */
  @IsOptional()
  @IsUUID()
  departmentId?: string;

  /** Sort field (default: curated `sortOrder`, then name). */
  @IsOptional()
  @IsIn(SORT_FIELDS)
  sortBy?: SortField;

  /** Sort direction (default `asc`). */
  @IsOptional()
  @Transform(toSortOrder)
  @IsIn(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc';
}
