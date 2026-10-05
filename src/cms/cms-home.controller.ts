import { Body, Controller, Get, HttpCode, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequirePermission } from '../permissions/decorators/require-permission.decorator';
import { User } from '../users/entities/user.entity';
import { CmsHomeChangesService } from './cms-home-changes.service';
import { CmsHomeService } from './cms-home.service';
import {
  CmsHomeChangeResponseDto,
  CmsHomeEditorStateDto,
  CmsHomePreviewLinkDto,
  UpdateCmsHomeLayoutDto,
} from './dto/cms-home.dto';

const RECENT_CHANGES = 30;

// Singleton resource: the draft is edited in place, `publish` copies it to
// the live store. Banners are edited through cms/banners and join the draft.
@ApiTags('cms')
@ApiBearerAuth()
@Controller('cms/home')
export class CmsHomeController {
  constructor(
    private readonly homeService: CmsHomeService,
    private readonly changes: CmsHomeChangesService,
  ) {}

  @Get()
  @RequirePermission({ module: 'cms-home', action: 'read' })
  @ApiOperation({ summary: 'Draft layout plus publication status' })
  async find(): Promise<CmsHomeEditorStateDto> {
    return CmsHomeEditorStateDto.fromState(
      await this.homeService.getEditorState(),
    );
  }

  @Patch()
  @RequirePermission({ module: 'cms-home', action: 'update' })
  @ApiOperation({
    summary: 'Replace the draft layout (not visible until published)',
  })
  async update(
    @Body() dto: UpdateCmsHomeLayoutDto,
    @CurrentUser() actor: User,
  ): Promise<CmsHomeEditorStateDto> {
    return CmsHomeEditorStateDto.fromState(
      await this.homeService.updateLayout(dto, actor),
    );
  }

  @Post('publish')
  @HttpCode(200)
  @RequirePermission({ module: 'cms-home', action: 'publish' })
  @ApiOperation({
    summary: 'Copy the draft and active banners to the live store',
  })
  async publish(@CurrentUser() actor: User): Promise<CmsHomeEditorStateDto> {
    return CmsHomeEditorStateDto.fromState(
      await this.homeService.publish(actor),
    );
  }

  @Post('preview')
  @HttpCode(200)
  @RequirePermission({ module: 'cms-home', action: 'read' })
  @ApiOperation({ summary: 'Short-lived storefront link that shows the draft' })
  preview(): CmsHomePreviewLinkDto {
    return this.homeService.createPreviewLink();
  }

  @Get('changes')
  @RequirePermission({ module: 'cms-home', action: 'read' })
  @ApiOperation({ summary: 'Latest home edits with author and date' })
  async listChanges(): Promise<CmsHomeChangeResponseDto[]> {
    const changes = await this.changes.listRecent(RECENT_CHANGES);
    return changes.map(CmsHomeChangeResponseDto.fromEntity);
  }
}
