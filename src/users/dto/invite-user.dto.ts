import { Transform } from 'class-transformer';
import {
  IsArray,
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { Role } from '../entities/user.entity';

/** One-release compat shim: cached pre-collapse frontend bundles still send
 *  the old enum values. Remove after the next frontend release. */
export const legacyRoleToStaff = ({ value }: { value: unknown }): unknown =>
  value === 'GROCER' || value === 'KARDIST' ? Role.STAFF : value;

export class InviteUserDto {
  @IsEmail()
  email: string;

  @Transform(legacyRoleToStaff)
  @IsEnum(Role)
  role: Role;

  /** Managed roles the invited STAFF user gets when they register. */
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  roleIds?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(100)
  firstName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  lastName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  organizationId?: string;
}
