import { Transform } from 'class-transformer';
import {
  IsIn,
  IsISO8601,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

/** Lo que la pantalla de cobros puede filtrar. */
export const ESTADOS_DE_COBRO = [
  'cobrado',
  'pendiente',
  'reembolsado',
] as const;
export type EstadoDeCobro = (typeof ESTADOS_DE_COBRO)[number];

/**
 * De dónde salió el cobro, que es lo que la tarjeta subraya: «hay que poder
 * saber qué entró de verdad y qué apuntó alguien».
 */
export const ORIGENES = ['pasarela', 'manual'] as const;
export type OrigenDelCobro = (typeof ORIGENES)[number];

export class CollectionsQueryDto {
  /** Desde, inclusive. Se compara contra la fecha de pago o, si no hay, la del pedido. */
  @IsOptional()
  @IsISO8601()
  from?: string;

  /** Hasta, inclusive: se cuenta el día entero. */
  @IsOptional()
  @IsISO8601()
  to?: string;

  @IsOptional()
  @IsIn(ESTADOS_DE_COBRO)
  status?: EstadoDeCobro;

  @IsOptional()
  @IsIn(ORIGENES)
  origin?: OrigenDelCobro;

  /** Código del método de pago, tal como lo guarda el cobro o el pedido. */
  @IsOptional()
  @IsString()
  method?: string;

  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  @Max(500)
  limit?: number;
}
