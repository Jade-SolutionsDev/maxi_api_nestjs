import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import type { BannerAsset } from '../entities/cms-banner.entity';
import type { CmsPopup } from '../entities/cms-popup.entity';

export class PopupAssetDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  src: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  width: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  height: number;
}

export class CreateCmsPopupDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(160)
  title: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(600)
  body: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  buttonLabel?: string | null;

  /** Sin texto de botón no hay botón, así que un enlace suelto no vale. */
  @ValidateIf((dto: CreateCmsPopupDto) => dto.buttonHref != null)
  @IsString()
  @IsNotEmpty()
  @MaxLength(300)
  buttonHref?: string | null;

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => PopupAssetDto)
  desktop?: PopupAssetDto | null;

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => PopupAssetDto)
  tablet?: PopupAssetDto | null;

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => PopupAssetDto)
  mobile?: PopupAssetDto | null;

  @IsOptional()
  @IsISO8601()
  startsAt?: string | null;

  @IsOptional()
  @IsISO8601()
  endsAt?: string | null;

  /** Un día, una semana… El tope evita un «vuelve en diez años» por error. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(8760)
  repeatAfterHours?: number | null;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateCmsPopupDto extends CreateCmsPopupDto {
  @IsOptional()
  @IsString()
  @MaxLength(160)
  declare title: string;

  @IsOptional()
  @IsString()
  @MaxLength(600)
  declare body: string;
}

/** Lo que ve la administración: el aviso entero, publicado o no. */
export class CmsPopupResponseDto {
  id: string;
  title: string;
  body: string;
  buttonLabel: string | null;
  buttonHref: string | null;
  desktop: BannerAsset | null;
  tablet: BannerAsset | null;
  mobile: BannerAsset | null;
  startsAt: Date | null;
  endsAt: Date | null;
  repeatAfterHours: number | null;
  isActive: boolean;
  publishedAt: Date | null;
  /** `borrador`, `programado`, `vigente` o `caducado`, ya resuelto aquí. */
  state: PopupState;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: Date;
  updatedAt: Date;

  static fromEntity(
    popup: CmsPopup,
    now: Date = new Date(),
  ): CmsPopupResponseDto {
    const dto = new CmsPopupResponseDto();
    dto.id = popup.id;
    dto.title = popup.title;
    dto.body = popup.body;
    dto.buttonLabel = popup.buttonLabel;
    dto.buttonHref = popup.buttonHref;
    dto.desktop = popup.desktop;
    dto.tablet = popup.tablet;
    dto.mobile = popup.mobile;
    dto.startsAt = popup.startsAt;
    dto.endsAt = popup.endsAt;
    dto.repeatAfterHours = popup.repeatAfterHours;
    dto.isActive = popup.isActive;
    dto.publishedAt = popup.publishedAt;
    dto.state = popupState(popup, now);
    dto.createdBy = popup.createdBy;
    dto.updatedBy = popup.updatedBy;
    dto.createdAt = popup.createdAt;
    dto.updatedAt = popup.updatedAt;
    return dto;
  }
}

export type PopupState = 'borrador' | 'programado' | 'vigente' | 'caducado';

/**
 * En qué punto de su vida está el aviso. Se resuelve en la API y no en el
 * panel para que la pantalla y la tienda no puedan discrepar sobre lo mismo.
 */
export function popupState(
  popup: CmsPopup,
  now: Date = new Date(),
): PopupState {
  if (!popup.publishedAt || !popup.isActive) return 'borrador';
  if (popup.endsAt && popup.endsAt <= now) return 'caducado';
  if (popup.startsAt && popup.startsAt > now) return 'programado';
  return 'vigente';
}

/** Lo que ve la tienda: solo lo que hace falta para pintarlo. */
export class PublicCmsPopupDto {
  id: string;
  title: string;
  body: string;
  buttonLabel: string | null;
  buttonHref: string | null;
  desktop: BannerAsset | null;
  tablet: BannerAsset | null;
  mobile: BannerAsset | null;
  repeatAfterHours: number | null;
  /**
   * Cambia cuando cambia el contenido del aviso. La tienda lo guarda junto al
   * cierre: si el aviso se edita, vuelve a salirle a quien ya lo había
   * cerrado, que es lo que se espera de un anuncio nuevo.
   */
  version: string;

  static fromEntity(popup: CmsPopup): PublicCmsPopupDto {
    const dto = new PublicCmsPopupDto();
    dto.id = popup.id;
    dto.title = popup.title;
    dto.body = popup.body;
    dto.buttonLabel = popup.buttonLabel;
    dto.buttonHref = popup.buttonHref;
    dto.desktop = popup.desktop;
    dto.tablet = popup.tablet;
    dto.mobile = popup.mobile;
    dto.repeatAfterHours = popup.repeatAfterHours;
    dto.version = String(popup.updatedAt.getTime());
    return dto;
  }
}
