import { Transform, TransformFnParams } from 'class-transformer';
import { IsBoolean, IsEnum, IsIn, IsOptional, IsString } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';
import { Role } from '../entities/user.entity';

export const USER_STATUS_FILTERS = ['active', 'inactive', 'pending'] as const;
export type UserStatusFilter = (typeof USER_STATUS_FILTERS)[number];

/** Coerce `?flag=true|false` query strings into real booleans (or leave absent). */
const toOptionalBoolean = ({ value }: TransformFnParams): unknown => {
  if (value === undefined || value === '') {
    return undefined;
  }
  if (value === 'true' || value === true) {
    return true;
  }
  if (value === 'false' || value === false) {
    return false;
  }
  return value;
};

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
