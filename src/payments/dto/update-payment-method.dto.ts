import {
  IsBoolean,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

/** Admins own presentation and availability; `code` and credentials are not editable. */
export class UpdatePaymentMethodDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  label?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  icon?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;

  /**
   * Ajustes no secretos del método (moneda, días de caducidad…).
   *
   * `@IsObject()` sin esquema: se acepta cualquier forma. Y desde MxH-0133 este
   * objeto lo lee **todo el que tenga `orders:list`**, no solo un admin — ver el
   * comentario de `PaymentMethodsController`. Hoy está nulo en los siete
   * métodos de staging y la entidad lo documenta como «non-secret», así que la
   * garantía descansa en esa documentación y no en una validación.
   *
   * **Las credenciales no van aquí: van en el entorno.** Si algún día hace
   * falta guardar algo sensible por método, no cabe en este campo — habría que
   * añadir uno aparte que el DTO de respuesta no devuelva.
   */
  @IsOptional()
  @IsObject()
  config?: Record<string, unknown>;
}
