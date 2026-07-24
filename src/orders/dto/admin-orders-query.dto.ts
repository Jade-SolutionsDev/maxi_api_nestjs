import { IsEnum, IsOptional, IsString } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';
import { OrderStatus, PaymentStatus } from '../entities/order.entity';

export class AdminOrdersQueryDto extends PaginationQueryDto {
  /** Matches order number, client name or client email (ILIKE). */
  @IsOptional()
  @IsString()
  q?: string;

  @IsOptional()
  @IsEnum(OrderStatus)
  status?: OrderStatus;

  @IsOptional()
  @IsEnum(PaymentStatus)
  paymentStatus?: PaymentStatus;

  /** Comma-separated ids (react-admin getMany). */
  @IsOptional()
  @IsString()
  id?: string;
}
