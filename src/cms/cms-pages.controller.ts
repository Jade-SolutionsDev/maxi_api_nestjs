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
import { CmsService } from './cms.service';
import {
  CmsPageResponseDto,
  CreateCmsPageDto,
  UpdateCmsPageDto,
} from './dto/cms-page.dto';

// Content management is an admin task: no per-module permissions, plain
// role gate (same pattern as clients/permissions controllers).
@ApiTags('cms')
@ApiBearerAuth()
@Controller('cms/pages')
export class CmsPagesController {
  constructor(private readonly cmsService: CmsService) {}

  @Get()
  @RequirePermission({ module: 'cms-pages', action: 'list' })
  async findAll(): Promise<CmsPageResponseDto[]> {
    const pages = await this.cmsService.listPagesAdmin();
    return pages.map(CmsPageResponseDto.fromEntity);
  }

  @Get(':id')
  @RequirePermission({ module: 'cms-pages', action: 'read' })
  async findOne(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<CmsPageResponseDto> {
    return CmsPageResponseDto.fromEntity(await this.cmsService.getPage(id));
  }

  @Post()
  @RequirePermission({ module: 'cms-pages', action: 'create' })
  async create(@Body() dto: CreateCmsPageDto): Promise<CmsPageResponseDto> {
    return CmsPageResponseDto.fromEntity(await this.cmsService.createPage(dto));
  }

  @Patch(':id')
  @RequirePermission({ module: 'cms-pages', action: 'update' })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCmsPageDto,
  ): Promise<CmsPageResponseDto> {
    return CmsPageResponseDto.fromEntity(
      await this.cmsService.updatePage(id, dto),
    );
  }

  @Delete(':id')
  @RequirePermission({ module: 'cms-pages', action: 'delete' })
  @HttpCode(204)
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.cmsService.removePage(id);
  }
}
