import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { BannerAsset, CmsBanner } from '../entities/cms-banner.entity';

/**
 * `width`/`height` must be the real intrinsic dimensions of the uploaded
 * image: the storefront builds next/image srcsets from them, and a 0 or
 * missing dimension breaks the hero render.
 */
export class BannerAssetDto implements BannerAsset {
  @IsString()
  @MaxLength(2048)
  src: string;

  @IsInt()
  @Min(1)
  width: number;

  @IsInt()
  @Min(1)
  height: number;
}

export class CreateCmsBannerDto {
  @IsString()
  @MaxLength(160)
  alt: string;

  @ValidateNested()
  @Type(() => BannerAssetDto)
  desktop: BannerAssetDto;

  @ValidateNested()
  @Type(() => BannerAssetDto)
  tablet: BannerAssetDto;

  @ValidateNested()
  @Type(() => BannerAssetDto)
  mobile: BannerAssetDto;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateCmsBannerDto {
  @IsOptional()
  @IsString()
  @MaxLength(160)
  alt?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => BannerAssetDto)
  desktop?: BannerAssetDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => BannerAssetDto)
  tablet?: BannerAssetDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => BannerAssetDto)
  mobile?: BannerAssetDto;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class CmsBannerResponseDto {
  id: string;
  alt: string;
  desktop: BannerAsset;
  tablet: BannerAsset;
  mobile: BannerAsset;
  sortOrder: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;

  static fromEntity(entity: CmsBanner): CmsBannerResponseDto {
    const dto = new CmsBannerResponseDto();
    dto.id = entity.id;
    dto.alt = entity.alt;
    dto.desktop = entity.desktop;
    dto.tablet = entity.tablet;
    dto.mobile = entity.mobile;
    dto.sortOrder = entity.sortOrder;
    dto.isActive = entity.isActive;
    dto.createdAt = entity.createdAt;
    dto.updatedAt = entity.updatedAt;
    return dto;
  }
}
