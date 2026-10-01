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
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequirePermission } from '../permissions/decorators/require-permission.decorator';
import { User } from '../users/entities/user.entity';
import { CmsPagesService } from './cms-pages.service';
import {
  CmsPageResponseDto,
  CmsPageVersionResponseDto,
  CreateCmsPageDto,
  UpdateCmsPageDto,
} from './dto/cms-page.dto';
import { CmsPageKind } from './entities/cms-page.entity';

/**
 * Routes shared by every kind of editable text. Info pages and home notices
 * are the same document (draft + published versions) behind the same
 * `cms-pages` permission; each subclass only fixes the kind it serves.
 * `update` edits the draft, `publish` puts it on the store.
 */
abstract class CmsTextsController {
  protected constructor(
    private readonly pages: CmsPagesService,
    private readonly kind: CmsPageKind,
  ) {}

  @Get()
  @RequirePermission({ module: 'cms-pages', action: 'list' })
  async findAll(): Promise<CmsPageResponseDto[]> {
    const pages = await this.pages.listAdmin(this.kind);
    return pages.map(CmsPageResponseDto.fromEntity);
  }

  @Get(':id')
  @RequirePermission({ module: 'cms-pages', action: 'read' })
  async findOne(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<CmsPageResponseDto> {
    return CmsPageResponseDto.fromEntity(await this.pages.get(this.kind, id));
  }

  @Post()
  @RequirePermission({ module: 'cms-pages', action: 'create' })
  @ApiOperation({
    summary: 'Create a draft (not on the store until published)',
  })
  async create(
    @Body() dto: CreateCmsPageDto,
    @CurrentUser() actor: User,
  ): Promise<CmsPageResponseDto> {
    return CmsPageResponseDto.fromEntity(
      await this.pages.create(this.kind, dto, actor),
    );
  }

  @Patch(':id')
  @RequirePermission({ module: 'cms-pages', action: 'update' })
  @ApiOperation({
    summary: 'Edit the draft; order, visibility and dates apply at once',
  })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCmsPageDto,
    @CurrentUser() actor: User,
  ): Promise<CmsPageResponseDto> {
    return CmsPageResponseDto.fromEntity(
      await this.pages.update(this.kind, id, dto, actor),
    );
  }

  @Post(':id/publish')
  @HttpCode(200)
  @RequirePermission({ module: 'cms-pages', action: 'publish' })
  @ApiOperation({ summary: 'Publish the draft as a new version' })
  async publish(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: User,
  ): Promise<CmsPageResponseDto> {
    return CmsPageResponseDto.fromEntity(
      await this.pages.publish(this.kind, id, actor),
    );
  }

  @Get(':id/versions')
  @RequirePermission({ module: 'cms-pages', action: 'read' })
  @ApiOperation({ summary: 'Every published version, newest first' })
  async versions(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<CmsPageVersionResponseDto[]> {
    const versions = await this.pages.listVersions(this.kind, id);
    return versions.map(CmsPageVersionResponseDto.fromEntity);
  }

  @Delete(':id')
  @RequirePermission({ module: 'cms-pages', action: 'delete' })
  @HttpCode(204)
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.pages.remove(this.kind, id);
  }
}

@ApiTags('cms')
@ApiBearerAuth()
@Controller('cms/pages')
export class CmsPagesController extends CmsTextsController {
  constructor(pages: CmsPagesService) {
    super(pages, CmsPageKind.PAGE);
  }
}

@ApiTags('cms')
@ApiBearerAuth()
@Controller('cms/home-notices')
export class CmsHomeNoticesController extends CmsTextsController {
  constructor(pages: CmsPagesService) {
    super(pages, CmsPageKind.HOME_NOTICE);
  }
}
