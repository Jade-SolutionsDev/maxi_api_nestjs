import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsOptional, IsUUID } from 'class-validator';
import {
  toOptionalBoolean,
  toSortOrder,
} from '../../common/dto/query-transforms';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

// Storefront endpoints already return only *valid* rows (active departments
// with in-stock categories / active categories with in-stock products), so no
// opt-in validity flag is needed — these DTOs only carry genuine facets.
// `municipalityId` narrows "in stock" to the storages covering that delivery
// zone, so a location-scoped storefront gets zone-accurate lists and counts.

// Storefront taxonomy sort. Default (omitted) → curated `sortOrder`, then name.
const SORT_FIELDS = ['name', 'sortOrder', 'createdAt'] as const;
type SortField = (typeof SORT_FIELDS)[number];

export class PublicCatalogQueryDto {
  /** Delivery municipality; scopes validity and counts to deliverable stock. */
  @IsOptional()
  @IsUUID()
  municipalityId?: string;
}

export class PublicDepartmentsQueryDto extends PaginationQueryDto {
  /** Only departments flagged as featured. */
  @IsOptional()
  @Transform(toOptionalBoolean)
  @IsBoolean()
  featured?: boolean;

  /** Delivery municipality; scopes validity to deliverable stock. */
  @IsOptional()
  @IsUUID()
  municipalityId?: string;

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

export class PublicCategoriesQueryDto extends PaginationQueryDto {
  /** Restrict to a single department (parent). */
  @IsOptional()
  @IsUUID()
  departmentId?: string;

  /** Delivery municipality; scopes validity to deliverable stock. */
  @IsOptional()
  @IsUUID()
  municipalityId?: string;

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
