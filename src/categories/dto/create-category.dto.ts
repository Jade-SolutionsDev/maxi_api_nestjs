import {
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  MaxLength,
} from 'class-validator';
import { IsImageUrl } from '../../common/validators/is-image-url.validator';

export class CreateCategoryDto {
  @IsUUID()
  departmentId: string;

  @IsString()
  @IsNotEmpty()
  @Length(1, 100)
  name: string;

  @IsOptional()
  @IsString()
  @Length(1, 100)
  slug?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(2048)
  @IsImageUrl()
  imageDesktopUrl: string;

  /**
   * Opcional a propósito: **una sola imagen basta para crear una categoría**.
   * La tienda cae a la de escritorio cuando esta falta
   * (`taxonomy.adapter.ts`), y el formulario del admin dejó de exigirla el
   * 26-ago-2026 — pero aquí se seguía exigiendo, así que guardar con una sola
   * imagen respondía 400 y la categoría no se creaba (MxH-0019, reportado por
   * QA el 7-sep-2026).
   */
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  @IsImageUrl()
  imageMobileUrl?: string;

  @IsOptional()
  sortOrder?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
