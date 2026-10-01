import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import {
  BannerView,
  CmsBannerResolvedTarget,
  CmsBannerTargetReference,
  CmsBannerTargetType,
  CmsBannerView,
} from '../cms-banner.types';
import type { HomeBannerSnapshot } from '../cms-home.types';
import { BannerAsset } from '../entities/cms-banner.entity';

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

export class CmsBannerTargetDto implements CmsBannerTargetReference {
  @IsEnum(CmsBannerTargetType)
  type: CmsBannerTargetType;

  @IsUUID()
  id: string;
}

export class CreateCmsBannerDto {
  @IsString()
  @MaxLength(160)
  alt: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  title?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  subtitle?: string | null;

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

  @IsOptional()
  @ValidateNested()
  @Type(() => CmsBannerTargetDto)
  target?: CmsBannerTargetDto | null;
}

export class UpdateCmsBannerDto {
  @IsOptional()
  @IsString()
  @MaxLength(160)
  alt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  title?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  subtitle?: string | null;

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

  @IsOptional()
  @ValidateNested()
  @Type(() => CmsBannerTargetDto)
  target?: CmsBannerTargetDto | null;
}

export class CmsBannerResponseDto {
  id: string;
  alt: string;
  title: string | null;
  subtitle: string | null;
  desktop: BannerAsset;
  tablet: BannerAsset;
  mobile: BannerAsset;
  sortOrder: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  target: CmsBannerResolvedTarget | null;

  static fromView(view: CmsBannerView): CmsBannerResponseDto {
    const { banner: entity } = view;
    const dto = new CmsBannerResponseDto();
    dto.id = entity.id;
    dto.alt = entity.alt;
    dto.title = entity.title;
    dto.subtitle = entity.subtitle;
    dto.desktop = entity.desktop;
    dto.tablet = entity.tablet;
    dto.mobile = entity.mobile;
    dto.sortOrder = entity.sortOrder;
    dto.isActive = entity.isActive;
    dto.createdAt = entity.createdAt;
    dto.updatedAt = entity.updatedAt;
    dto.target = view.target;
    return dto;
  }
}

export class PublicCmsBannerTargetDto implements CmsBannerTargetReference {
  type: CmsBannerTargetType;
  id: string;
  slug: string;
}

/**
 * One storefront slide, already in display order. Built from the published
 * home copy, so it carries content only — no row ordering or timestamps.
 */
export class PublicCmsBannerResponseDto {
  id: string;
  alt: string;
  title: string | null;
  subtitle: string | null;
  desktop: BannerAsset;
  tablet: BannerAsset;
  mobile: BannerAsset;
  target: PublicCmsBannerTargetDto | null;

  static fromView(
    view: BannerView<HomeBannerSnapshot>,
  ): PublicCmsBannerResponseDto {
    const { banner } = view;
    const dto = new PublicCmsBannerResponseDto();
    dto.id = banner.id;
    dto.alt = banner.alt;
    dto.title = banner.title;
    dto.subtitle = banner.subtitle;
    dto.desktop = banner.desktop;
    dto.tablet = banner.tablet;
    dto.mobile = banner.mobile;
    dto.target =
      view.target?.isAvailable && view.target.slug
        ? {
            type: view.target.type,
            id: view.target.id,
            slug: view.target.slug,
          }
        : null;
    return dto;
  }
}
