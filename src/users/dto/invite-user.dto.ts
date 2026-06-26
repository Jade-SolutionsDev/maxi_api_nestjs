import {
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { UserType } from '../entities/user.entity';

export class InviteUserDto {
  @IsEmail()
  email: string;

  @IsEnum(UserType)
  userType: UserType;

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
