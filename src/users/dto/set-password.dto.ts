import { IsString, MaxLength, MinLength } from 'class-validator';

export class SetPasswordDto {
  // Clerk requires >= 8 chars; 72 is the bcrypt input ceiling Clerk enforces.
  @IsString()
  @MinLength(8)
  @MaxLength(72)
  password: string;
}
