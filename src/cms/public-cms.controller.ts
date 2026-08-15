import { Controller, Get, Header, Param } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { TAXONOMY_CACHE } from '../common/constants/cache-control';
import { Public } from '../common/decorators/public.decorator';
import { CmsService } from './cms.service';
import { CmsBannerResponseDto } from './dto/cms-banner.dto';
import { CmsPageResponseDto } from './dto/cms-page.dto';
import { CmsServiceResponseDto } from './dto/cms-service.dto';
import { SiteSettingsData } from './entities/cms-site-settings.entity';
import { CmsStaffMemberResponseDto } from './dto/cms-staff-member.dto';

// Unauthenticated storefront content. Editorial data is small and stable:
// every route returns the full active set (no pagination) and shares the
// taxonomy Cache-Control profile; the storefront caches it under the 'cms'
// tag and gets pinged on every admin write.
@ApiTags('storefront')
@Controller('public/cms')
@Public()
export class PublicCmsController {
  constructor(private readonly cmsService: CmsService) {}

  @Get('settings')
  @Header('Cache-Control', TAXONOMY_CACHE)
  @ApiOperation({ summary: 'Site-wide settings (footer, contact, payments…)' })
  async settings(): Promise<SiteSettingsData> {
    return this.cmsService.getSettings();
  }

  @Get('banners')
  @Header('Cache-Control', TAXONOMY_CACHE)
  @ApiOperation({ summary: 'Active hero banners, in display order' })
  async banners(): Promise<CmsBannerResponseDto[]> {
    const banners = await this.cmsService.listBannersPublic();
    return banners.map(CmsBannerResponseDto.fromEntity);
  }

  @Get('services')
  @Header('Cache-Control', TAXONOMY_CACHE)
  @ApiOperation({ summary: 'Active service cards, in display order' })
  async services(): Promise<CmsServiceResponseDto[]> {
    const services = await this.cmsService.listServicesPublic();
    return services.map(CmsServiceResponseDto.fromEntity);
  }

  @Get('staff')
  @Header('Cache-Control', TAXONOMY_CACHE)
  @ApiOperation({ summary: 'Active staff cards, in display order' })
  async staff(): Promise<CmsStaffMemberResponseDto[]> {
    const staff = await this.cmsService.listStaffPublic();
    return staff.map(CmsStaffMemberResponseDto.fromEntity);
  }

  @Get('pages')
  @Header('Cache-Control', TAXONOMY_CACHE)
  @ApiOperation({ summary: 'Active pages (for menus/links)' })
  async pages(): Promise<CmsPageResponseDto[]> {
    const pages = await this.cmsService.listPagesPublic();
    return pages.map(CmsPageResponseDto.fromEntity);
  }

  @Get('pages/:slug')
  @Header('Cache-Control', TAXONOMY_CACHE)
  @ApiOperation({
    summary: 'One active page by slug (404 if missing/inactive)',
  })
  async page(@Param('slug') slug: string): Promise<CmsPageResponseDto> {
    return CmsPageResponseDto.fromEntity(
      await this.cmsService.getPageBySlugPublic(slug),
    );
  }
}
