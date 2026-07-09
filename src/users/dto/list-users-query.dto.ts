import { Transform, TransformFnParams } from 'class-transformer';
import { IsBoolean, IsEnum, IsOptional, IsString } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';
import { Role } from '../entities/user.entity';

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

  @IsOptional()
  @Transform(toOptionalBoolean)
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @Transform(toOptionalBoolean)
  @IsBoolean()
  includeInvitations?: boolean;
}
