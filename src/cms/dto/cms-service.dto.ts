import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { CmsService as CmsServiceEntity } from '../entities/cms-service.entity';

export class CreateCmsServiceDto {
  /** lucide-react icon name; the storefront allowlists and falls back. */
  @IsString()
  @MaxLength(60)
  icon: string;

  @IsString()
  @MaxLength(120)
  title: string;

  @IsString()
  description: string;

  @IsOptional()
  @IsBoolean()
  isFeatured?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateCmsServiceDto {
  @IsOptional()
  @IsString()
  @MaxLength(60)
  icon?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  title?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsBoolean()
  isFeatured?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class CmsServiceResponseDto {
  id: string;
  icon: string;
  title: string;
  description: string;
  isFeatured: boolean;
  sortOrder: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;

  static fromEntity(entity: CmsServiceEntity): CmsServiceResponseDto {
    const dto = new CmsServiceResponseDto();
    dto.id = entity.id;
    dto.icon = entity.icon;
    dto.title = entity.title;
    dto.description = entity.description;
    dto.isFeatured = entity.isFeatured;
    dto.sortOrder = entity.sortOrder;
    dto.isActive = entity.isActive;
    dto.createdAt = entity.createdAt;
    dto.updatedAt = entity.updatedAt;
    return dto;
  }
}
