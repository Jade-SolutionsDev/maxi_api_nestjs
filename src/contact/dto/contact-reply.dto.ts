import { IsEnum, IsOptional, IsString, IsUUID, Length } from 'class-validator';
import { ContactReplyChannel } from '../entities/contact-reply.entity';

export class CreateContactReplyDto {
  @IsEnum(ContactReplyChannel)
  channel: ContactReplyChannel;

  @IsOptional()
  @IsUUID()
  templateId?: string;

  /** Text sent/used, or the note itself for channel 'nota'. */
  @IsOptional()
  @IsString()
  @Length(1, 4000)
  body?: string;
}
