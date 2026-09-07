import { IsBoolean, IsEnum, IsOptional } from 'class-validator';
import { OrderStatus } from '../entities/order.entity';

export class UpdateOrderStatusDto {
  /** Target status; must be a legal transition from the current one. */
  @IsEnum(OrderStatus)
  status: OrderStatus;

  /**
   * Jump straight to the target, skipping intermediate steps (manual in-store
   * sales, pickups). Forward-only or to cancelled; the skipped side effects
   * (stock commit on passing confirmed, release on cancel) still apply.
   * SUPER_ADMIN/ADMIN/GROCER only — the step-by-step path stays the safe
   * default for lower-privilege roles.
   */
  @IsOptional()
  @IsBoolean()
  direct?: boolean;
}
