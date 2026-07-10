import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional, IsUUID } from 'class-validator';
import { toOptionalBoolean } from '../../common/dto/query-transforms';

export class PublicDepartmentsQueryDto {
  /** Only departments flagged as featured. */
  @IsOptional()
  @Transform(toOptionalBoolean)
  @IsBoolean()
  featured?: boolean;

  /** Only departments that have ≥1 active child category with products. */
  @IsOptional()
  @Transform(toOptionalBoolean)
  @IsBoolean()
  hasActiveCategories?: boolean;
}

export class PublicCategoriesQueryDto {
  /** Restrict to a single department (parent). */
  @IsOptional()
  @IsUUID()
  departmentId?: string;

  /** Only categories that have ≥1 product associated. */
  @IsOptional()
  @Transform(toOptionalBoolean)
  @IsBoolean()
  active?: boolean;
}
