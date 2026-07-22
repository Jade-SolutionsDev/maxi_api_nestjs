import { Transform } from 'class-transformer';
import { IsBoolean, IsEnum, IsIn, IsOptional, IsString } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';
import { toOptionalBoolean } from '../../common/dto/query-transforms';
import { Role } from '../entities/user.entity';

export const USER_STATUS_FILTERS = [
  'active',
  'inactive',
  'pending',
  'awaiting_approval',
] as const;
export type UserStatusFilter = (typeof USER_STATUS_FILTERS)[number];

export class ListUsersQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  q?: string;

  @IsOptional()
  @IsEnum(Role)
  role?: Role;

  /** Status facet: active/inactive real users, or pending invitations only. */
  @IsOptional()
  @IsIn(USER_STATUS_FILTERS)
  status?: UserStatusFilter;

  @IsOptional()
  @Transform(toOptionalBoolean)
  @IsBoolean()
  includeInvitations?: boolean;

  /** Include soft-deleted users (for the "show deleted" view). */
  @IsOptional()
  @Transform(toOptionalBoolean)
  @IsBoolean()
  includeDeleted?: boolean;
}
