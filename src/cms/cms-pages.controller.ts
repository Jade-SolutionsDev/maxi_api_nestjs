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
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../users/entities/user.entity';
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
@Roles(Role.SUPER_ADMIN, Role.ADMIN)
export class CmsPagesController {
  constructor(private readonly cmsService: CmsService) {}

  @Get()
  async findAll(): Promise<CmsPageResponseDto[]> {
    const pages = await this.cmsService.listPagesAdmin();
    return pages.map(CmsPageResponseDto.fromEntity);
  }

  @Get(':id')
  async findOne(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<CmsPageResponseDto> {
    return CmsPageResponseDto.fromEntity(await this.cmsService.getPage(id));
  }

  @Post()
  async create(@Body() dto: CreateCmsPageDto): Promise<CmsPageResponseDto> {
    return CmsPageResponseDto.fromEntity(await this.cmsService.createPage(dto));
  }

  @Patch(':id')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCmsPageDto,
  ): Promise<CmsPageResponseDto> {
    return CmsPageResponseDto.fromEntity(
      await this.cmsService.updatePage(id, dto),
    );
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.cmsService.removePage(id);
  }
}
