import {
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  Length,
  MaxLength,
} from 'class-validator';
import { IsImageUrl } from '../../common/validators/is-image-url.validator';

export class CreateDepartmentDto {
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
   * Opcional a propósito, igual que en `CreateCategoryDto`: **una sola imagen
   * basta**. La tienda cae a la de escritorio cuando esta falta
   * (`taxonomy.adapter.ts`, que los departamentos atraviesan vía
   * `toTaxonomyGroup`), y el formulario del admin no la marca obligatoria
   * (`DepartmentFormModal.tsx`) — pero aquí se seguía exigiendo, así que
   * guardar con una sola imagen respondía 400 y el departamento no se creaba.
   *
   * MxH-0019 arregló este mismo desajuste en categorías y dejó fuera los
   * departamentos; MxH-0154 es el que quedó vivo.
   */
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  @IsImageUrl()
  imageMobileUrl?: string;

  @IsOptional()
  @IsBoolean()
  isFeatured?: boolean;

  @IsOptional()
  sortOrder?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
