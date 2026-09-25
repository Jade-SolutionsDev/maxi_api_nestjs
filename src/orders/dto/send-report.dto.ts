import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsEmail,
  IsIn,
  IsOptional,
  IsUUID,
  ValidateNested,
} from 'class-validator';
import { AdminOrdersQueryDto } from './admin-orders-query.dto';

/**
 * A quién se le manda el reporte y con qué filtros.
 *
 * Los destinatarios llegan por dos vías porque responden a dos preguntas
 * distintas: «mándaselo a esta persona» y «mándaselo a quien lleve las
 * cuentas». La segunda sobrevive a que alguien entre o salga del equipo sin
 * que nadie se acuerde de actualizar una lista de correos.
 */
export class SendReportDto {
  /** Direcciones sueltas, escritas a mano. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsEmail({}, { each: true })
  emails?: string[];

  /**
   * Roles configurables (`roles`), no los tres del enum: son los que tienen
   * gente asignada y los que el administrador crea, como «Economista».
   */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsUUID('4', { each: true })
  roleIds?: string[];

  /** Los mismos filtros del reporte, tal como los manda el formulario. */
  @IsOptional()
  @ValidateNested()
  @Type(() => AdminOrdersQueryDto)
  filtros?: AdminOrdersQueryDto;

  @IsOptional()
  @IsIn(['day', 'week', 'month'])
  groupBy?: 'day' | 'week' | 'month';
}
