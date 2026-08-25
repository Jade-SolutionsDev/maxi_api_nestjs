import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../permissions/decorators/require-permission.decorator';
import { ContactService } from './contact.service';
import {
  ContactTemplateResponseDto,
  CreateContactTemplateDto,
  UpdateContactTemplateDto,
} from './dto/contact-template.dto';

// Reply drafts live with the inbox: same 'contact' permission module, so
// whoever answers messages can also maintain their canned answers.
@ApiTags('contact')
@ApiBearerAuth()
@Controller('contact/templates')
export class ContactTemplatesController {
  constructor(private readonly contactService: ContactService) {}

  @Get()
  @RequirePermission({ module: 'contact', action: 'list' })
  async findAll(): Promise<ContactTemplateResponseDto[]> {
    const rows = await this.contactService.listTemplates();
    return rows.map(ContactTemplateResponseDto.fromEntity);
  }

  @Get(':id')
  @RequirePermission({ module: 'contact', action: 'read' })
  async findOne(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ContactTemplateResponseDto> {
    return ContactTemplateResponseDto.fromEntity(
      await this.contactService.getTemplate(id),
    );
  }

  @Post()
  @RequirePermission({ module: 'contact', action: 'create' })
  async create(
    @Body() dto: CreateContactTemplateDto,
  ): Promise<ContactTemplateResponseDto> {
    return ContactTemplateResponseDto.fromEntity(
      await this.contactService.createTemplate(dto),
    );
  }

  @Patch(':id')
  @RequirePermission({ module: 'contact', action: 'update' })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateContactTemplateDto,
  ): Promise<ContactTemplateResponseDto> {
    return ContactTemplateResponseDto.fromEntity(
      await this.contactService.updateTemplate(id, dto),
    );
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermission({ module: 'contact', action: 'delete' })
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.contactService.removeTemplate(id);
  }
}
