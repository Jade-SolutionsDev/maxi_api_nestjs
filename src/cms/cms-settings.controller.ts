import { Body, Controller, Get, Patch } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../permissions/decorators/require-permission.decorator';
import { CmsService, DEFAULT_SITE_SETTINGS } from './cms.service';
import {
  SiteSettingsResponseDto,
  UpdateSiteSettingsDto,
} from './dto/cms-site-settings.dto';

// Singleton resource: GET/PATCH only, no collection semantics.
@ApiTags('cms')
@ApiBearerAuth()
@Controller('cms/settings')
export class CmsSettingsController {
  constructor(private readonly cmsService: CmsService) {}

  @Get()
  @RequirePermission({ module: 'cms-settings', action: 'read' })
  @ApiOperation({
    summary: 'Site settings document (defaults when never saved)',
  })
  async find(): Promise<SiteSettingsResponseDto> {
    const row = await this.cmsService.getSettingsRow();
    return SiteSettingsResponseDto.fromEntity(row, DEFAULT_SITE_SETTINGS);
  }

  @Patch()
  @RequirePermission({ module: 'cms-settings', action: 'update' })
  @ApiOperation({
    summary: 'Replace the whole settings document (last write wins)',
  })
  async update(
    @Body() dto: UpdateSiteSettingsDto,
  ): Promise<SiteSettingsResponseDto> {
    const row = await this.cmsService.updateSettings(dto);
    return SiteSettingsResponseDto.fromEntity(row, DEFAULT_SITE_SETTINGS);
  }
}
