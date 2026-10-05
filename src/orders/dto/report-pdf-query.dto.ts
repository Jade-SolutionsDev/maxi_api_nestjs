import { Transform } from 'class-transformer';
import { IsIn, IsOptional } from 'class-validator';
import { vacioEsNada } from '../../common/dto/query-transforms';
import { AdminOrdersQueryDto } from './admin-orders-query.dto';

/** Cómo agrupa el resumen del informe. */
export const PERIODOS = ['day', 'week', 'month'] as const;
export type Periodo = (typeof PERIODOS)[number];

/**
 * Los filtros del listado más el resumen por periodo.
 *
 * Existe porque `groupBy` solo tiene sentido aquí, y porque el validador global
 * lleva `forbidNonWhitelisted`: un parámetro que no esté declarado en el DTO no
 * se ignora, tumba la petición entera. El controlador lo leía por su cuenta con
 * `@Query('groupBy')`, pero para entonces el pipe ya había devuelto un 400
 * —«property groupBy should not exist»— y el PDF no se generaba nunca si se
 * elegía «Resumen por» en el formulario.
 */
export class ReportPdfQueryDto extends AdminOrdersQueryDto {
  @IsOptional()
  @Transform(vacioEsNada)
  @IsIn(PERIODOS)
  groupBy?: Periodo;
}
