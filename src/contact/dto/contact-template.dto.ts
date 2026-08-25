import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  MaxLength,
  Min,
} from 'class-validator';
import { ContactReplyTemplate } from '../entities/contact-reply-template.entity';

export class CreateContactTemplateDto {
  @IsString()
  @MaxLength(120)
  title: string;

  @IsString()
  @Length(1, 4000)
  body: string;

  @IsOptional()
  @IsUUID()
  motiveId?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateContactTemplateDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  title?: string;

  @IsOptional()
  @IsString()
  @Length(1, 4000)
  body?: string;

  @IsOptional()
  @IsUUID()
  motiveId?: string | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class ContactTemplateResponseDto {
  id: string;
  title: string;
  body: string;
  motiveId: string | null;
  sortOrder: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;

  static fromEntity(entity: ContactReplyTemplate): ContactTemplateResponseDto {
    const dto = new ContactTemplateResponseDto();
    dto.id = entity.id;
    dto.title = entity.title;
    dto.body = entity.body;
    dto.motiveId = entity.motiveId;
    dto.sortOrder = entity.sortOrder;
    dto.isActive = entity.isActive;
    dto.createdAt = entity.createdAt;
    dto.updatedAt = entity.updatedAt;
    return dto;
  }
}
