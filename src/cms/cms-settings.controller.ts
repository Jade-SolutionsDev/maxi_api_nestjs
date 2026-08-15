import { Body, Controller, Get, Patch } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../users/entities/user.entity';
import { CmsService, DEFAULT_SITE_SETTINGS } from './cms.service';
import {
  SiteSettingsResponseDto,
  UpdateSiteSettingsDto,
} from './dto/cms-site-settings.dto';

// Singleton resource: GET/PATCH only, no collection semantics.
@ApiTags('cms')
@ApiBearerAuth()
@Controller('cms/settings')
@Roles(Role.SUPER_ADMIN, Role.ADMIN)
export class CmsSettingsController {
  constructor(private readonly cmsService: CmsService) {}

  @Get()
  @ApiOperation({
    summary: 'Site settings document (defaults when never saved)',
  })
  async find(): Promise<SiteSettingsResponseDto> {
    const row = await this.cmsService.getSettingsRow();
    return SiteSettingsResponseDto.fromEntity(row, DEFAULT_SITE_SETTINGS);
  }

  @Patch()
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
