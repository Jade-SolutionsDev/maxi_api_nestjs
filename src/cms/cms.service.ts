import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Not, Repository } from 'typeorm';
import { slugify } from '../common/utils/catalog-ownership.utils';
import {
  CMS_REVALIDATE_TAGS,
  RevalidationService,
} from '../revalidation/revalidation.service';
import { CreateCmsBannerDto, UpdateCmsBannerDto } from './dto/cms-banner.dto';
import { CreateCmsPageDto, UpdateCmsPageDto } from './dto/cms-page.dto';
import {
  CreateCmsServiceDto,
  UpdateCmsServiceDto,
} from './dto/cms-service.dto';
import { UpdateSiteSettingsDto } from './dto/cms-site-settings.dto';
import {
  CreateCmsStaffMemberDto,
  UpdateCmsStaffMemberDto,
} from './dto/cms-staff-member.dto';
import { CmsBanner } from './entities/cms-banner.entity';
import { CmsPage } from './entities/cms-page.entity';
import { CmsService as CmsServiceEntity } from './entities/cms-service.entity';
import {
  CmsSiteSettings,
  SiteSettingsData,
} from './entities/cms-site-settings.entity';
import { CmsStaffMember } from './entities/cms-staff-member.entity';

/**
 * Served when the settings row does not exist yet (fresh database). Mirrors
 * the storefront's historical hardcoded content so a missing row is
 * indistinguishable from day one; the seed persists this same document.
 */
export const DEFAULT_SITE_SETTINGS: SiteSettingsData = {
  footer: {
    blurb:
      'Del mercado a tu mesa, sin complicaciones. Productos frescos y de confianza, con entrega rápida en toda La Habana.',
    copyright: '© 2026 Maxi. Todos los derechos reservados.',
    legalLinks: [
      { label: 'Política de privacidad', slug: 'politica-de-privacidad' },
      { label: 'Términos y condiciones', slug: 'terminos-y-condiciones' },
    ],
  },
  contact: {
    email: 'comercialmaxihabana@gmail.com',
    phone: '+53 5 432 6665',
  },
  payments: {
    visa: true,
    mastercard: true,
    mibilletera: false,
  },
  services: {
    heading: 'Nuestros servicios',
    subheading:
      'Cuidamos cada pedido para que tu familia en La Habana reciba lo que necesita, con la mejor calidad.',
  },
};

// Editorial content, no ownership scoping: reads are global, writes are gated
// to SUPER_ADMIN/ADMIN at the controllers. Public reads only expose active
// rows; admin reads are unfiltered so inactive content stays manageable.
@Injectable()
export class CmsService {
  constructor(
    @InjectRepository(CmsPage)
    private readonly pageRepository: Repository<CmsPage>,
    @InjectRepository(CmsBanner)
    private readonly bannerRepository: Repository<CmsBanner>,
    @InjectRepository(CmsServiceEntity)
    private readonly serviceRepository: Repository<CmsServiceEntity>,
    @InjectRepository(CmsStaffMember)
    private readonly staffRepository: Repository<CmsStaffMember>,
    @InjectRepository(CmsSiteSettings)
    private readonly settingsRepository: Repository<CmsSiteSettings>,
    private readonly revalidationService: RevalidationService,
  ) {}

  // ---------------- Pages ----------------

  async createPage(dto: CreateCmsPageDto): Promise<CmsPage> {
    const slug = await this.ensureUniquePageSlug(dto.slug ?? dto.title);
    const page = this.pageRepository.create({
      slug,
      title: dto.title,
      content: dto.content,
      sortOrder: dto.sortOrder ?? 0,
      isActive: dto.isActive ?? true,
    });
    const saved = await this.pageRepository.save(page);
    this.revalidationService.notify(CMS_REVALIDATE_TAGS);
    return saved;
  }

  async listPagesAdmin(): Promise<CmsPage[]> {
    return this.pageRepository.find({
      order: { sortOrder: 'ASC', title: 'ASC' },
    });
  }

  async getPage(id: string): Promise<CmsPage> {
    const page = await this.pageRepository.findOne({ where: { id } });
    if (!page) {
      throw new NotFoundException(`Page with id "${id}" not found`);
    }
    return page;
  }

  async updatePage(id: string, dto: UpdateCmsPageDto): Promise<CmsPage> {
    const page = await this.getPage(id);
    if (dto.title !== undefined) {
      page.title = dto.title;
    }
    if (dto.slug !== undefined) {
      page.slug = await this.ensureUniquePageSlug(dto.slug, id);
    }
    if (dto.content !== undefined) {
      page.content = dto.content;
    }
    if (dto.sortOrder !== undefined) {
      page.sortOrder = dto.sortOrder;
    }
    if (dto.isActive !== undefined) {
      page.isActive = dto.isActive;
    }
    const saved = await this.pageRepository.save(page);
    this.revalidationService.notify(CMS_REVALIDATE_TAGS);
    return saved;
  }

  /**
   * Frees the slug before soft-deleting: slug uniqueness counts soft-deleted
   * rows, and footer legal links reference pages BY SLUG — without this,
   * recreating a deleted page ("terminos-y-condiciones") would land on a
   * suffixed slug ("-2") and silently break every stored reference.
   */
  async removePage(id: string): Promise<void> {
    const page = await this.getPage(id);
    page.slug = `${page.slug}-eliminada-${Date.now()}`;
    await this.pageRepository.save(page);
    await this.pageRepository.softDelete(id);
    this.revalidationService.notify(CMS_REVALIDATE_TAGS);
  }

  async listPagesPublic(): Promise<CmsPage[]> {
    return this.pageRepository.find({
      where: { isActive: true },
      order: { sortOrder: 'ASC', title: 'ASC' },
    });
  }

  async getPageBySlugPublic(slug: string): Promise<CmsPage> {
    const page = await this.pageRepository.findOne({
      where: { slug, isActive: true },
    });
    if (!page) {
      throw new NotFoundException(`Page with slug "${slug}" not found`);
    }
    return page;
  }

  // ---------------- Banners ----------------

  async createBanner(dto: CreateCmsBannerDto): Promise<CmsBanner> {
    const banner = this.bannerRepository.create({
      alt: dto.alt,
      desktop: dto.desktop,
      tablet: dto.tablet,
      mobile: dto.mobile,
      sortOrder: dto.sortOrder ?? 0,
      isActive: dto.isActive ?? true,
    });
    const saved = await this.bannerRepository.save(banner);
    this.revalidationService.notify(CMS_REVALIDATE_TAGS);
    return saved;
  }

  async listBannersAdmin(): Promise<CmsBanner[]> {
    return this.bannerRepository.find({
      order: { sortOrder: 'ASC', createdAt: 'ASC' },
    });
  }

  async getBanner(id: string): Promise<CmsBanner> {
    const banner = await this.bannerRepository.findOne({ where: { id } });
    if (!banner) {
      throw new NotFoundException(`Banner with id "${id}" not found`);
    }
    return banner;
  }

  async updateBanner(id: string, dto: UpdateCmsBannerDto): Promise<CmsBanner> {
    const banner = await this.getBanner(id);
    if (dto.alt !== undefined) {
      banner.alt = dto.alt;
    }
    if (dto.desktop !== undefined) {
      banner.desktop = dto.desktop;
    }
    if (dto.tablet !== undefined) {
      banner.tablet = dto.tablet;
    }
    if (dto.mobile !== undefined) {
      banner.mobile = dto.mobile;
    }
    if (dto.sortOrder !== undefined) {
      banner.sortOrder = dto.sortOrder;
    }
    if (dto.isActive !== undefined) {
      banner.isActive = dto.isActive;
    }
    const saved = await this.bannerRepository.save(banner);
    this.revalidationService.notify(CMS_REVALIDATE_TAGS);
    return saved;
  }

  async removeBanner(id: string): Promise<void> {
    await this.getBanner(id);
    await this.bannerRepository.softDelete(id);
    this.revalidationService.notify(CMS_REVALIDATE_TAGS);
  }

  async listBannersPublic(): Promise<CmsBanner[]> {
    return this.bannerRepository.find({
      where: { isActive: true },
      order: { sortOrder: 'ASC', createdAt: 'ASC' },
    });
  }

  // ---------------- Services ----------------

  async createService(dto: CreateCmsServiceDto): Promise<CmsServiceEntity> {
    const service = this.serviceRepository.create({
      icon: dto.icon,
      title: dto.title,
      description: dto.description,
      isFeatured: dto.isFeatured ?? false,
      sortOrder: dto.sortOrder ?? 0,
      isActive: dto.isActive ?? true,
    });
    const saved = await this.serviceRepository.save(service);
    this.revalidationService.notify(CMS_REVALIDATE_TAGS);
    return saved;
  }

  async listServicesAdmin(): Promise<CmsServiceEntity[]> {
    return this.serviceRepository.find({
      order: { sortOrder: 'ASC', title: 'ASC' },
    });
  }

  async getService(id: string): Promise<CmsServiceEntity> {
    const service = await this.serviceRepository.findOne({ where: { id } });
    if (!service) {
      throw new NotFoundException(`Service with id "${id}" not found`);
    }
    return service;
  }

  async updateService(
    id: string,
    dto: UpdateCmsServiceDto,
  ): Promise<CmsServiceEntity> {
    const service = await this.getService(id);
    if (dto.icon !== undefined) {
      service.icon = dto.icon;
    }
    if (dto.title !== undefined) {
      service.title = dto.title;
    }
    if (dto.description !== undefined) {
      service.description = dto.description;
    }
    if (dto.isFeatured !== undefined) {
      service.isFeatured = dto.isFeatured;
    }
    if (dto.sortOrder !== undefined) {
      service.sortOrder = dto.sortOrder;
    }
    if (dto.isActive !== undefined) {
      service.isActive = dto.isActive;
    }
    const saved = await this.serviceRepository.save(service);
    this.revalidationService.notify(CMS_REVALIDATE_TAGS);
    return saved;
  }

  async removeService(id: string): Promise<void> {
    await this.getService(id);
    await this.serviceRepository.softDelete(id);
    this.revalidationService.notify(CMS_REVALIDATE_TAGS);
  }

  async listServicesPublic(): Promise<CmsServiceEntity[]> {
    return this.serviceRepository.find({
      where: { isActive: true },
      order: { sortOrder: 'ASC', title: 'ASC' },
    });
  }

  // ---------------- Staff ----------------

  async createStaffMember(
    dto: CreateCmsStaffMemberDto,
  ): Promise<CmsStaffMember> {
    const member = this.staffRepository.create({
      name: dto.name,
      role: dto.role,
      photoUrl: dto.photoUrl ?? null,
      resume: dto.resume ?? null,
      sortOrder: dto.sortOrder ?? 0,
      isActive: dto.isActive ?? true,
    });
    const saved = await this.staffRepository.save(member);
    this.revalidationService.notify(CMS_REVALIDATE_TAGS);
    return saved;
  }

  async listStaffAdmin(): Promise<CmsStaffMember[]> {
    return this.staffRepository.find({
      order: { sortOrder: 'ASC', name: 'ASC' },
    });
  }

  async getStaffMember(id: string): Promise<CmsStaffMember> {
    const member = await this.staffRepository.findOne({ where: { id } });
    if (!member) {
      throw new NotFoundException(`Staff member with id "${id}" not found`);
    }
    return member;
  }

  async updateStaffMember(
    id: string,
    dto: UpdateCmsStaffMemberDto,
  ): Promise<CmsStaffMember> {
    const member = await this.getStaffMember(id);
    if (dto.name !== undefined) {
      member.name = dto.name;
    }
    if (dto.role !== undefined) {
      member.role = dto.role;
    }
    if (dto.photoUrl !== undefined) {
      member.photoUrl = dto.photoUrl;
    }
    if (dto.resume !== undefined) {
      member.resume = dto.resume;
    }
    if (dto.sortOrder !== undefined) {
      member.sortOrder = dto.sortOrder;
    }
    if (dto.isActive !== undefined) {
      member.isActive = dto.isActive;
    }
    const saved = await this.staffRepository.save(member);
    this.revalidationService.notify(CMS_REVALIDATE_TAGS);
    return saved;
  }

  async removeStaffMember(id: string): Promise<void> {
    await this.getStaffMember(id);
    await this.staffRepository.softDelete(id);
    this.revalidationService.notify(CMS_REVALIDATE_TAGS);
  }

  async listStaffPublic(): Promise<CmsStaffMember[]> {
    return this.staffRepository.find({
      where: { isActive: true },
      order: { sortOrder: 'ASC', name: 'ASC' },
    });
  }

  // ---------------- Site settings (singleton) ----------------

  async getSettingsRow(): Promise<CmsSiteSettings | null> {
    const rows = await this.settingsRepository.find({ take: 1 });
    return rows[0] ?? null;
  }

  async getSettings(): Promise<SiteSettingsData> {
    const row = await this.getSettingsRow();
    return row?.data ?? DEFAULT_SITE_SETTINGS;
  }

  async updateSettings(dto: UpdateSiteSettingsDto): Promise<CmsSiteSettings> {
    const row =
      (await this.getSettingsRow()) ?? this.settingsRepository.create();
    row.data = dto;
    const saved = await this.settingsRepository.save(row);
    this.revalidationService.notify(CMS_REVALIDATE_TAGS);
    return saved;
  }

  // ---------------- Internal helpers ----------------

  // Same contract as the taxonomy slug helper: derive from the source text,
  // then suffix -2, -3… until unique (soft-deleted rows included so a slug is
  // never resurrected under different content).
  private async ensureUniquePageSlug(
    source: string,
    excludeId?: string,
  ): Promise<string> {
    const base = slugify(source);
    let candidate = base;
    let suffix = 2;
    for (;;) {
      const clash = await this.pageRepository.findOne({
        where: excludeId
          ? { slug: candidate, id: Not(excludeId) }
          : { slug: candidate },
        withDeleted: true,
      });
      if (!clash) {
        return candidate;
      }
      candidate = `${base}-${suffix}`;
      suffix += 1;
    }
  }
}
