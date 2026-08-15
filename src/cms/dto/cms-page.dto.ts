import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { CmsPage } from '../entities/cms-page.entity';

export class CreateCmsPageDto {
  @IsString()
  @MaxLength(160)
  title: string;

  /** Optional explicit slug; derived from the title when omitted. */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  slug?: string;

  /** Markdown source. */
  @IsString()
  content: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateCmsPageDto {
  @IsOptional()
  @IsString()
  @MaxLength(160)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  slug?: string;

  @IsOptional()
  @IsString()
  content?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class CmsPageResponseDto {
  id: string;
  slug: string;
  title: string;
  content: string;
  sortOrder: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;

  static fromEntity(entity: CmsPage): CmsPageResponseDto {
    const dto = new CmsPageResponseDto();
    dto.id = entity.id;
    dto.slug = entity.slug;
    dto.title = entity.title;
    dto.content = entity.content;
    dto.sortOrder = entity.sortOrder;
    dto.isActive = entity.isActive;
    dto.createdAt = entity.createdAt;
    dto.updatedAt = entity.updatedAt;
    return dto;
  }
}
