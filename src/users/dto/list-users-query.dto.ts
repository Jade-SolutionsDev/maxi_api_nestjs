import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsOptional, IsString } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';
import { toOptionalBoolean } from '../../common/dto/query-transforms';
import { legacyRoleToStaff } from './invite-user.dto';

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

  /**
   * Overloaded filter: an access tier (`Role` value) or a managed-role uuid.
   * One param because the list UI exposes a single "Rol" dropdown mixing both.
   */
  @IsOptional()
  @Transform(legacyRoleToStaff)
  @IsString()
  role?: string;

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
