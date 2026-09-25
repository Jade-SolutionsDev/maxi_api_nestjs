import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { OrderStatus } from '../entities/order.entity';

/**
 * Quién se llevó el pedido. Se pide al entregar porque en una recogida casi
 * nunca es el comprador: está en el extranjero y va un familiar al mostrador.
 */
export class PickedUpByDto {
  @IsString()
  @MinLength(3)
  @MaxLength(120)
  name: string;

  /** Carné de identidad de quien retira. */
  @IsOptional()
  @IsString()
  @MaxLength(20)
  idCard?: string;
}

export class UpdateOrderStatusDto {
  /** Target status; must be a legal transition from the current one. */
  @IsEnum(OrderStatus)
  status: OrderStatus;

  /**
   * Jump straight to the target, skipping intermediate steps (manual in-store
   * sales, pickups). Forward-only or to cancelled; the skipped side effects
   * (stock commit on passing confirmed, release on cancel) still apply.
   * admins or the orders:update-status-direct permission — the step-by-step path stays the safe
   * default for lower-privilege roles.
   */
  @IsOptional()
  @IsBoolean()
  direct?: boolean;

  /**
   * Solo al pasar a `delivered`: a quién se le entregó. Si no se dice, se
   * copia de los datos de contacto del pedido.
   */
  @IsOptional()
  @ValidateNested()
  @Type(() => PickedUpByDto)
  pickedUpBy?: PickedUpByDto;
}
