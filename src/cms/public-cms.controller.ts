import { Controller, Get, Header, Headers, Param } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  SCHEDULED_CONTENT_CACHE,
  TAXONOMY_CACHE,
} from '../common/constants/cache-control';
import { Public } from '../common/decorators/public.decorator';
import { CmsService } from './cms.service';
import { CmsPagesService } from './cms-pages.service';
import { CmsFaqService } from './cms-faq.service';
import { CmsHomeService } from './cms-home.service';
import { PublicCmsBannerResponseDto } from './dto/cms-banner.dto';
import { PublicHomeResponseDto } from './dto/cms-home.dto';
import {
  PublicCmsPageResponseDto,
  PublicHomeNoticeDto,
} from './dto/cms-page.dto';
import { CmsServiceResponseDto } from './dto/cms-service.dto';
import { SiteSettingsData } from './entities/cms-site-settings.entity';
import { CmsStaffMemberResponseDto } from './dto/cms-staff-member.dto';
import { PublicCmsFaqCategoryDto } from './dto/cms-faq.dto';

const STOREFRONT_SECRET_HEADER = 'x-storefront-secret';

// Unauthenticated storefront content. Editorial data is small and stable:
// every route returns the full active set (no pagination) and shares the
// taxonomy Cache-Control profile; the storefront caches it under the 'cms'
// tag and gets pinged on every admin write.
@ApiTags('storefront')
@Controller('public/cms')
@Public()
export class PublicCmsController {
  constructor(
    private readonly cmsService: CmsService,
    private readonly faqService: CmsFaqService,
    private readonly homeService: CmsHomeService,
    private readonly pagesService: CmsPagesService,
  ) {}

  @Get('settings')
  @Header('Cache-Control', TAXONOMY_CACHE)
  @ApiOperation({ summary: 'Site-wide settings (footer, contact, payments…)' })
  async settings(): Promise<SiteSettingsData> {
    return this.cmsService.getSettings();
  }

  @Get('home')
  @Header('Cache-Control', TAXONOMY_CACHE)
  @ApiOperation({
    summary: 'Published home: section order, curated featured ids, banners',
  })
  async home(): Promise<PublicHomeResponseDto> {
    return PublicHomeResponseDto.fromView(
      await this.homeService.getPublishedHome(),
    );
  }

  // Draft of the same document, for the storefront's draft mode only: the
  // storefront server proves itself with the secret both sides share.
  @Get('home/draft')
  @Header('Cache-Control', 'private, no-store')
  @ApiOperation({ summary: 'Unpublished home, for storefront previews' })
  async draftHome(
    @Headers(STOREFRONT_SECRET_HEADER) secret?: string,
  ): Promise<PublicHomeResponseDto> {
    this.homeService.assertStorefrontSecret(secret);
    return PublicHomeResponseDto.fromView(
      await this.homeService.getDraftHome(),
    );
  }

  @Get('banners')
  @Header('Cache-Control', TAXONOMY_CACHE)
  @ApiOperation({ summary: 'Published hero banners, in display order' })
  async banners(): Promise<PublicCmsBannerResponseDto[]> {
    const { banners } = await this.homeService.getPublishedHome();
    return banners.map(PublicCmsBannerResponseDto.fromView);
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

  @Get('faqs')
  @Header('Cache-Control', TAXONOMY_CACHE)
  @ApiOperation({ summary: 'Active FAQ categories and questions in order' })
  faqs(): Promise<PublicCmsFaqCategoryDto[]> {
    return this.faqService.listPublic();
  }

  @Get('home-notices')
  @Header('Cache-Control', SCHEDULED_CONTENT_CACHE)
  @ApiOperation({
    summary: 'Published home notices that are within their dates right now',
  })
  async homeNotices(): Promise<PublicHomeNoticeDto[]> {
    const notices = await this.pagesService.listVisibleHomeNotices();
    return notices.map(PublicHomeNoticeDto.fromEntity);
  }

  @Get('pages')
  @Header('Cache-Control', TAXONOMY_CACHE)
  @ApiOperation({ summary: 'Published, active pages (for menus/links)' })
  async pages(): Promise<PublicCmsPageResponseDto[]> {
    const pages = await this.pagesService.listPublishedPages();
    return pages.map(PublicCmsPageResponseDto.fromEntity);
  }

  @Get('pages/:slug')
  @Header('Cache-Control', TAXONOMY_CACHE)
  @ApiOperation({
    summary: 'Published version of one active page (404 if never published)',
  })
  async page(@Param('slug') slug: string): Promise<PublicCmsPageResponseDto> {
    return PublicCmsPageResponseDto.fromEntity(
      await this.pagesService.getPublishedPage(slug),
    );
  }
}
