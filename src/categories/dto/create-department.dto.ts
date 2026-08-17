import {
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  Length,
  MaxLength,
} from 'class-validator';

export class CreateDepartmentDto {
  @IsString()
  @IsNotEmpty()
  @Length(1, 100)
  name: string;

  @IsOptional()
  @IsString()
  @Length(1, 100)
  slug?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(2048)
  imageDesktopUrl: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(2048)
  imageMobileUrl: string;

  @IsOptional()
  @IsBoolean()
  isFeatured?: boolean;

  @IsOptional()
  sortOrder?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
