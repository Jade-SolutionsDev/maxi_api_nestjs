import { Type } from 'class-transformer';
import {
  IsEmail,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import {
  ContactMessage,
  ContactMessageStatus,
} from '../entities/contact-message.entity';
import { ContactReply } from '../entities/contact-reply.entity';

export class CreateContactMessageDto {
  @IsUUID()
  motiveId: string;

  @IsString()
  @Length(10, 2000)
  message: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  lastName?: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(255)
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  phone?: string;

  /**
   * Honeypot: hidden in the real form, so humans never fill it. A non-empty
   * value marks the submission as bot traffic and it is silently dropped.
   */
  @IsOptional()
  @IsString()
  @MaxLength(255)
  website?: string;
}

export class ContactMessagesQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  q?: string;

  @IsOptional()
  @IsUUID()
  motiveId?: string;

  @IsOptional()
  @IsEnum(ContactMessageStatus)
  status?: ContactMessageStatus;

  /** Inclusive lower bound, yyyy-mm-dd. */
  @IsOptional()
  @IsString()
  @MaxLength(10)
  createdFrom?: string;

  /** Inclusive upper bound, yyyy-mm-dd. */
  @IsOptional()
  @IsString()
  @MaxLength(10)
  createdTo?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;
}

export class UpdateContactMessageStatusDto {
  @IsEnum(ContactMessageStatus)
  status: ContactMessageStatus;
}

export class ContactReplyResponseDto {
  id: string;
  channel: string;
  templateId: string | null;
  body: string | null;
  userId: string;
  userName: string | null;
  createdAt: Date;

  static fromEntity(
    entity: ContactReply,
    userName: string | null,
  ): ContactReplyResponseDto {
    const dto = new ContactReplyResponseDto();
    dto.id = entity.id;
    dto.channel = entity.channel;
    dto.templateId = entity.templateId;
    dto.body = entity.body;
    dto.userId = entity.userId;
    dto.userName = userName;
    dto.createdAt = entity.createdAt;
    return dto;
  }
}

export class ContactMessageResponseDto {
  id: string;
  motiveId: string;
  motiveLabel: string | null;
  clientId: string | null;
  name: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  message: string;
  status: ContactMessageStatus;
  createdAt: Date;
  updatedAt: Date;
  replies?: ContactReplyResponseDto[];

  static fromEntity(
    entity: ContactMessage,
    motiveLabel: string | null,
    replies?: ContactReplyResponseDto[],
  ): ContactMessageResponseDto {
    const dto = new ContactMessageResponseDto();
    dto.id = entity.id;
    dto.motiveId = entity.motiveId;
    dto.motiveLabel = motiveLabel;
    dto.clientId = entity.clientId;
    dto.name = entity.name;
    dto.lastName = entity.lastName;
    dto.email = entity.email;
    dto.phone = entity.phone;
    dto.message = entity.message;
    dto.status = entity.status;
    dto.createdAt = entity.createdAt;
    dto.updatedAt = entity.updatedAt;
    if (replies) {
      dto.replies = replies;
    }
    return dto;
  }
}
