import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsUUID,
  ValidateNested,
} from 'class-validator';
import type { CmsHomeEditorState, PublicHomeView } from '../cms-home.service';
import {
  CmsHomeChangeAction,
  HOME_SECTION_KEYS,
  HomeLayout,
  HomeSection,
  HomeSectionKey,
} from '../cms-home.types';
import type { CmsHomeChange } from '../entities/cms-home-change.entity';
import { PublicCmsBannerResponseDto } from './cms-banner.dto';

/** The storefront shows up to 24 products and departments per section. */
const MAX_FEATURED = 24;

export class HomeSectionDto implements HomeSection {
  @IsIn(HOME_SECTION_KEYS)
  key: HomeSectionKey;

  @IsBoolean()
  isVisible: boolean;
}

/**
 * Whole-document replace of the draft layout. The order of `sections` and of
 * each featured list is the display order.
 */
export class UpdateCmsHomeLayoutDto implements HomeLayout {
  @IsArray()
  @ArrayMaxSize(HOME_SECTION_KEYS.length)
  @ValidateNested({ each: true })
  @Type(() => HomeSectionDto)
  sections: HomeSectionDto[];

  @IsArray()
  @ArrayMaxSize(MAX_FEATURED)
  @IsUUID('all', { each: true })
  featuredProductIds: string[];

  @IsArray()
  @ArrayMaxSize(MAX_FEATURED)
  @IsUUID('all', { each: true })
  featuredDepartmentIds: string[];
}

export class CmsHomeEditorStateDto {
  layout: HomeLayout;
  updatedAt: Date | null;
  updatedBy: string | null;
  publishedAt: Date | null;
  publishedBy: string | null;
  hasUnpublishedChanges: boolean;

  static fromState(state: CmsHomeEditorState): CmsHomeEditorStateDto {
    return Object.assign(new CmsHomeEditorStateDto(), state);
  }
}

export class CmsHomePreviewLinkDto {
  url: string;
  expiresAt: Date;
}

export class CmsHomeChangeResponseDto {
  id: string;
  action: CmsHomeChangeAction;
  subject: string | null;
  actorName: string;
  createdAt: Date;

  static fromEntity(change: CmsHomeChange): CmsHomeChangeResponseDto {
    const dto = new CmsHomeChangeResponseDto();
    dto.id = change.id;
    dto.action = change.action;
    dto.subject = change.subject;
    dto.actorName = change.actorName;
    dto.createdAt = change.createdAt;
    return dto;
  }
}

/**
 * The home as the storefront renders it. Empty featured lists mean «no
 * curated selection»: show the catalog's featured flags instead.
 */
export class PublicHomeResponseDto implements HomeLayout {
  sections: HomeSection[];
  featuredProductIds: string[];
  featuredDepartmentIds: string[];
  banners: PublicCmsBannerResponseDto[];

  static fromView(view: PublicHomeView): PublicHomeResponseDto {
    const dto = new PublicHomeResponseDto();
    dto.sections = view.layout.sections;
    dto.featuredProductIds = view.layout.featuredProductIds;
    dto.featuredDepartmentIds = view.layout.featuredDepartmentIds;
    dto.banners = view.banners.map(PublicCmsBannerResponseDto.fromView);
    return dto;
  }
}
