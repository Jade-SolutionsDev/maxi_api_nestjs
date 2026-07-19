import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional, IsUUID } from 'class-validator';
import { toOptionalBoolean } from '../../common/dto/query-transforms';

// Storefront endpoints already return only *valid* rows (active departments
// with in-stock categories / active categories with in-stock products), so no
// opt-in validity flag is needed — these DTOs only carry genuine facets.

export class PublicDepartmentsQueryDto {
  /** Only departments flagged as featured. */
  @IsOptional()
  @Transform(toOptionalBoolean)
  @IsBoolean()
  featured?: boolean;
}

export class PublicCategoriesQueryDto {
  /** Restrict to a single department (parent). */
  @IsOptional()
  @IsUUID()
  departmentId?: string;
}
