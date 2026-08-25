import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedUserRequest } from '../auth/types/authenticated-request';
import { PaginatedResponse } from '../common/dto/pagination.dto';
import { RequirePermission } from '../permissions/decorators/require-permission.decorator';
import { ContactService } from './contact.service';
import {
  ContactMessageResponseDto,
  ContactMessagesQueryDto,
  UpdateContactMessageStatusDto,
} from './dto/contact-message.dto';
import { CreateContactReplyDto } from './dto/contact-reply.dto';

// Shared support inbox: grantable to non-admin staff through the 'contact'
// permission module (managers bypass, as everywhere).
@ApiTags('contact')
@ApiBearerAuth()
@Controller('contact/messages')
export class ContactMessagesController {
  constructor(private readonly contactService: ContactService) {}

  @Get()
  @RequirePermission({ module: 'contact', action: 'list' })
  @ApiOperation({ summary: 'Inbox, newest first (server-paginated)' })
  async findAll(
    @Query() query: ContactMessagesQueryDto,
  ): Promise<PaginatedResponse<ContactMessageResponseDto>> {
    return this.contactService.listMessages(query);
  }

  @Get('config')
  @RequirePermission({ module: 'contact', action: 'list' })
  @ApiOperation({ summary: 'Feature switches for the inbox UI' })
  config(): { platformReplyEnabled: boolean } {
    return { platformReplyEnabled: this.contactService.platformReplyEnabled };
  }

  @Get(':id')
  @RequirePermission({ module: 'contact', action: 'read' })
  @ApiOperation({ summary: 'One message with its reply log' })
  async findOne(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ContactMessageResponseDto> {
    return this.contactService.getMessage(id);
  }

  @Patch(':id/status')
  @RequirePermission({ module: 'contact', action: 'update' })
  async updateStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateContactMessageStatusDto,
  ): Promise<ContactMessageResponseDto> {
    return this.contactService.updateStatus(id, dto.status);
  }

  @Post(':id/replies')
  @RequirePermission({ module: 'contact', action: 'update' })
  @ApiOperation({
    summary: 'Record a reply action (email/whatsapp/telefono/nota/plataforma)',
    description:
      "'plataforma' actually sends the email and answers 503 until the mail " +
      'service is configured; the other channels only log what the agent did ' +
      "off-platform. Any channel except 'nota' marks the message respondido.",
  })
  async addReply(
    @Req() req: AuthenticatedUserRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateContactReplyDto,
  ): Promise<ContactMessageResponseDto> {
    return this.contactService.addReply(id, req.user.id, dto);
  }
}
