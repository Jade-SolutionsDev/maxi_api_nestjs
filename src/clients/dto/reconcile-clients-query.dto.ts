import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional } from 'class-validator';
import { toOptionalBoolean } from '../../common/dto/query-transforms';

export class ReconcileClientsQueryDto {
  /**
   * Sin esto la pasada cuenta y no escribe. Es deliberado: el primer uso de
   * esto va contra la base de producción, y lo que hace falta antes de dar
   * nada de alta es saber a cuánta gente afecta.
   */
  @IsOptional()
  @Transform(toOptionalBoolean)
  @IsBoolean()
  apply?: boolean;
}
