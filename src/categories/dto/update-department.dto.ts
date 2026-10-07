import {
  IsBoolean,
  IsOptional,
  IsString,
  Length,
  MaxLength,
} from 'class-validator';
import { IsImageUrl } from '../../common/validators/is-image-url.validator';

export class UpdateDepartmentDto {
  @IsOptional()
  @IsString()
  @Length(1, 100)
  name?: string;

  @IsOptional()
  @IsString()
  @Length(1, 100)
  slug?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  @IsImageUrl()
  imageDesktopUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  @IsImageUrl()
  imageMobileUrl?: string;

  @IsOptional()
  @IsBoolean()
  isFeatured?: boolean;

  @IsOptional()
  sortOrder?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
