import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';
import { toOptionalBoolean } from '../../common/dto/query-transforms';
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

  /** All orders of one customer (admin client-detail view). */
  @IsOptional()
  @IsUUID()
  clientId?: string;

  /** Pickup orders holding reserved stock away from their pickup storage. */
  @IsOptional()
  @Transform(toOptionalBoolean)
  @IsBoolean()
  needsTransfer?: boolean;
}
