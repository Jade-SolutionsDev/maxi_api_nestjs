import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsString,
  IsUrl,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import {
  CmsSiteSettings,
  SiteSettingsData,
} from '../entities/cms-site-settings.entity';

export class SiteLegalLinkDto {
  @IsString()
  @MaxLength(80)
  label: string;

  /** CmsPage slug the storefront links to (/paginas/[slug]). */
  @IsString()
  @MaxLength(120)
  slug: string;
}

export class SiteSocialLinkDto {
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  label: string;

  /**
   * Solo http(s). Sin esto cabría un `javascript:` y ese enlace acaba en el
   * pie de la tienda y en ocho plantillas de correo.
   */
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true })
  @MaxLength(300)
  url: string;
}

export class SiteFooterDto {
  @IsString()
  @MaxLength(500)
  blurb: string;

  @IsString()
  @MaxLength(160)
  copyright: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SiteLegalLinkDto)
  legalLinks: SiteLegalLinkDto[];
}

export class SiteContactDto {
  @IsEmail()
  @MaxLength(160)
  email: string;

  @IsString()
  @MaxLength(40)
  phone: string;
}

export class SitePaymentsDto {
  @IsBoolean()
  visa: boolean;

  @IsBoolean()
  mastercard: boolean;

  @IsBoolean()
  mibilletera: boolean;
}

export class SiteServicesSectionDto {
  @IsString()
  @MaxLength(120)
  heading: string;

  @IsString()
  @MaxLength(300)
  subheading: string;
}

/**
 * Whole-object replace: the admin form always submits the complete settings
 * document, so a PATCH carries every section (last write wins by design).
 */
export class UpdateSiteSettingsDto implements SiteSettingsData {
  @ValidateNested()
  @Type(() => SiteFooterDto)
  footer: SiteFooterDto;

  @ValidateNested()
  @Type(() => SiteContactDto)
  contact: SiteContactDto;

  @ValidateNested()
  @Type(() => SitePaymentsDto)
  payments: SitePaymentsDto;

  @ValidateNested()
  @Type(() => SiteServicesSectionDto)
  services: SiteServicesSectionDto;

  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => SiteSocialLinkDto)
  social: SiteSocialLinkDto[];
}

export class SiteSettingsResponseDto {
  data: SiteSettingsData;
  updatedAt: Date | null;

  static fromEntity(
    entity: CmsSiteSettings | null,
    fallback: SiteSettingsData,
  ): SiteSettingsResponseDto {
    const dto = new SiteSettingsResponseDto();
    dto.data = entity?.data ?? fallback;
    dto.updatedAt = entity?.updatedAt ?? null;
    return dto;
  }
}
