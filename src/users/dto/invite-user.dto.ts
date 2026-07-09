import {
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { Role } from '../entities/user.entity';

export class InviteUserDto {
  @IsEmail()
  email: string;

  @IsEnum(Role)
  role: Role;

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
