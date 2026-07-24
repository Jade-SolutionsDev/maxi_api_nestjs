import { IsEnum } from 'class-validator';
import { OrderStatus } from '../entities/order.entity';

export class UpdateOrderStatusDto {
  /** Target status; must be a legal transition from the current one. */
  @IsEnum(OrderStatus)
  status: OrderStatus;
}
