import {
  IsBoolean,
  IsDateString,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { publicationStatusOf } from '../cms-page.publication';
import type { CmsPagePublicationStatus } from '../cms-page.publication';
import { CmsPage, CmsPageKind } from '../entities/cms-page.entity';
import { CmsPageVersion } from '../entities/cms-page-version.entity';

export class CreateCmsPageDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(160)
  title: string;

  /** Optional explicit slug; derived from the title when omitted. */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  slug?: string;

  /** Markdown source of the DRAFT. May be empty until it is published. */
  @IsString()
  content: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  /** Home notices only; ignored for info pages. Null clears it. */
  @IsOptional()
  @IsDateString()
  startsAt?: string | null;

  /** Home notices only; ignored for info pages. Null clears it. */
  @IsOptional()
  @IsDateString()
  endsAt?: string | null;
}

export class UpdateCmsPageDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
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

  @IsOptional()
  @IsDateString()
  startsAt?: string | null;

  @IsOptional()
  @IsDateString()
  endsAt?: string | null;
}

export class CmsPageVersionResponseDto {
  id: string;
  version: number;
  title: string;
  content: string;
  publishedAt: Date;
  publishedBy: string;

  static fromEntity(entity: CmsPageVersion): CmsPageVersionResponseDto {
    const dto = new CmsPageVersionResponseDto();
    dto.id = entity.id;
    dto.version = entity.version;
    dto.title = entity.title;
    dto.content = entity.content;
    dto.publishedAt = entity.publishedAt;
    dto.publishedBy = entity.publishedByName;
    return dto;
  }
}

/** Backoffice view: the draft, plus what the store shows today. */
export class CmsPageResponseDto {
  id: string;
  kind: CmsPageKind;
  slug: string;
  /** Draft title. */
  title: string;
  /** Draft Markdown. */
  content: string;
  sortOrder: number;
  isActive: boolean;
  startsAt: Date | null;
  endsAt: Date | null;
  draftUpdatedAt: Date | null;
  draftUpdatedBy: string | null;
  publicationStatus: CmsPagePublicationStatus;
  published: CmsPageVersionResponseDto | null;
  createdAt: Date;
  updatedAt: Date;

  static fromEntity(entity: CmsPage): CmsPageResponseDto {
    const dto = new CmsPageResponseDto();
    dto.id = entity.id;
    dto.kind = entity.kind;
    dto.slug = entity.slug;
    dto.title = entity.title;
    dto.content = entity.content;
    dto.sortOrder = entity.sortOrder;
    dto.isActive = entity.isActive;
    dto.startsAt = entity.startsAt;
    dto.endsAt = entity.endsAt;
    dto.draftUpdatedAt = entity.draftUpdatedAt;
    dto.draftUpdatedBy = entity.draftUpdatedBy;
    dto.publicationStatus = publicationStatusOf(entity);
    dto.published = entity.publishedVersion
      ? CmsPageVersionResponseDto.fromEntity(entity.publishedVersion)
      : null;
    dto.createdAt = entity.createdAt;
    dto.updatedAt = entity.updatedAt;
    return dto;
  }
}

/**
 * Storefront view of a PUBLISHED page. Same shape the store has always read,
 * so a storefront deployed before this API keeps working; title and content
 * come from the published version, never from the draft.
 */
export class PublicCmsPageResponseDto {
  id: string;
  slug: string;
  title: string;
  content: string;
  sortOrder: number;
  isActive: boolean;
  createdAt: Date;
  /** When the version on display was published. */
  updatedAt: Date;

  static fromEntity(entity: CmsPage): PublicCmsPageResponseDto {
    const published = entity.publishedVersion!;
    const dto = new PublicCmsPageResponseDto();
    dto.id = entity.id;
    dto.slug = entity.slug;
    dto.title = published.title;
    dto.content = published.content;
    dto.sortOrder = entity.sortOrder;
    dto.isActive = entity.isActive;
    dto.createdAt = entity.createdAt;
    dto.updatedAt = published.publishedAt;
    return dto;
  }
}

export class PublicHomeNoticeDto {
  id: string;
  title: string;
  content: string;
  startsAt: Date | null;
  endsAt: Date | null;

  static fromEntity(entity: CmsPage): PublicHomeNoticeDto {
    const published = entity.publishedVersion!;
    const dto = new PublicHomeNoticeDto();
    dto.id = entity.id;
    dto.title = published.title;
    dto.content = published.content;
    dto.startsAt = entity.startsAt;
    dto.endsAt = entity.endsAt;
    return dto;
  }
}
