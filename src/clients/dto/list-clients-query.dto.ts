import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional, IsString } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';
import { toOptionalBoolean } from '../../common/dto/query-transforms';

/**
 * Los campos por los que la administración deja ordenar la tabla. Es una lista
 * cerrada a propósito: `sortBy` llega de la URL y termina dentro de un
 * `ORDER BY`, así que lo que no esté aquí se ignora en vez de viajar al SQL.
 */
export const CAMPOS_ORDENABLES = [
  'email',
  'firstName',
  'lastName',
  'isActive',
  'onboardingCompleted',
  'createdAt',
  'updatedAt',
] as const;

export type CampoOrdenable = (typeof CAMPOS_ORDENABLES)[number];

export class ListClientsQueryDto extends PaginationQueryDto {
  /** Texto libre: nombre, apellidos, correo o teléfono. */
  @IsOptional()
  @IsString()
  q?: string;

  @IsOptional()
  @Transform(toOptionalBoolean)
  @IsBoolean()
  isActive?: boolean;

  /**
   * Lista de identificadores separados por comas. La usa la administración para
   * resolver referencias sueltas —el cliente de un pedido, por ejemplo— sin
   * depender de que ese cliente caiga en la primera página.
   */
  @IsOptional()
  @IsString()
  id?: string;
}
