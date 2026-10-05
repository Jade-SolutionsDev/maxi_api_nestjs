import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { CategoriesService } from '../categories/categories.service';
import { Category } from '../categories/entities/category.entity';
import { Product } from '../products/entities/product.entity';
import { ProductsService } from '../products/products.service';
import {
  CMS_REVALIDATE_TAGS,
  RevalidationService,
} from '../revalidation/revalidation.service';
import { CreateCmsBannerDto, UpdateCmsBannerDto } from './dto/cms-banner.dto';
import {
  BannerTargetSource,
  BannerView,
  CmsBannerResolvedTarget,
  CmsBannerTargetReference,
  CmsBannerTargetType,
  CmsBannerView,
} from './cms-banner.types';
import { CmsHomeChangesService } from './cms-home-changes.service';
import { CmsHomeChangeAction } from './cms-home.types';
import type { User } from '../users/entities/user.entity';
import {
  CreateCmsServiceDto,
  UpdateCmsServiceDto,
} from './dto/cms-service.dto';
import { conRedes, UpdateSiteSettingsDto } from './dto/cms-site-settings.dto';
import {
  CreateCmsStaffMemberDto,
  UpdateCmsStaffMemberDto,
} from './dto/cms-staff-member.dto';
import { CmsBanner } from './entities/cms-banner.entity';
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
    phone: '+53 5251 9414',
  },
  payments: {
    visa: true,
    mastercard: true,
    mibilletera: false,
  },
  // Los mismos enlaces que vivían en código, para que el día que esto se
  // despliegue no cambie nada sin que nadie haya tocado el panel. El de
  // Facebook es el canónico —el que se comparte desde la app redirige aquí— y
  // el de Instagram va sin el `?stkn=`, que es un token de sesión de quien
  // copió el enlace y no debe publicarse.
  social: [
    {
      label: 'Facebook',
      url: 'https://www.facebook.com/profile.php?id=61550740714835',
    },
    { label: 'Instagram', url: 'https://www.instagram.com/maxihabana' },
  ],
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
    @InjectRepository(CmsBanner)
    private readonly bannerRepository: Repository<CmsBanner>,
    @InjectRepository(Category)
    private readonly categoryRepository: Repository<Category>,
    @InjectRepository(Product)
    private readonly productRepository: Repository<Product>,
    private readonly categoriesService: CategoriesService,
    private readonly productsService: ProductsService,
    @InjectRepository(CmsServiceEntity)
    private readonly serviceRepository: Repository<CmsServiceEntity>,
    @InjectRepository(CmsStaffMember)
    private readonly staffRepository: Repository<CmsStaffMember>,
    @InjectRepository(CmsSiteSettings)
    private readonly settingsRepository: Repository<CmsSiteSettings>,
    private readonly revalidationService: RevalidationService,
    private readonly homeChanges: CmsHomeChangesService,
  ) {}

  // ---------------- Banners ----------------
  // Banner rows are the home DRAFT: writes are logged but never ping the
  // storefront, which serves the copy frozen by CmsHomeService.publish.

  async createBanner(
    dto: CreateCmsBannerDto,
    actor: User,
  ): Promise<CmsBannerView> {
    if (dto.target) {
      await this.validateBannerTarget(dto.target);
    }
    const banner = this.bannerRepository.create({
      alt: dto.alt,
      title: dto.title ?? null,
      subtitle: dto.subtitle ?? null,
      desktop: dto.desktop,
      tablet: dto.tablet,
      mobile: dto.mobile,
      targetType: dto.target?.type ?? null,
      targetId: dto.target?.id ?? null,
      sortOrder: dto.sortOrder ?? 0,
      isActive: dto.isActive ?? true,
    });
    const saved = await this.bannerRepository.save(banner);
    await this.homeChanges.record(
      CmsHomeChangeAction.BANNER_CREATED,
      saved.alt,
      actor,
    );
    return (await this.resolveBannerTargets([saved]))[0];
  }

  async listBannersAdmin(): Promise<CmsBannerView[]> {
    const banners = await this.bannerRepository.find({
      order: { sortOrder: 'ASC', createdAt: 'ASC' },
    });
    return this.resolveBannerTargets(banners);
  }

  async getBanner(id: string): Promise<CmsBannerView> {
    return (
      await this.resolveBannerTargets([await this.getBannerEntity(id)])
    )[0];
  }

  private async getBannerEntity(id: string): Promise<CmsBanner> {
    const banner = await this.bannerRepository.findOne({ where: { id } });
    if (!banner) {
      throw new NotFoundException(`Banner with id "${id}" not found`);
    }
    return banner;
  }

  async updateBanner(
    id: string,
    dto: UpdateCmsBannerDto,
    actor: User,
  ): Promise<CmsBannerView> {
    const banner = await this.getBannerEntity(id);
    if (dto.alt !== undefined) {
      banner.alt = dto.alt;
    }
    if (dto.title !== undefined) {
      banner.title = dto.title;
    }
    if (dto.subtitle !== undefined) {
      banner.subtitle = dto.subtitle;
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
    if (dto.target !== undefined) {
      if (dto.target === null) {
        banner.targetType = null;
        banner.targetId = null;
      } else {
        await this.validateBannerTarget(dto.target);
        banner.targetType = dto.target.type;
        banner.targetId = dto.target.id;
      }
    }
    const saved = await this.bannerRepository.save(banner);
    await this.homeChanges.record(
      CmsHomeChangeAction.BANNER_UPDATED,
      saved.alt,
      actor,
    );
    return (await this.resolveBannerTargets([saved]))[0];
  }

  async removeBanner(id: string, actor: User): Promise<void> {
    const banner = await this.getBannerEntity(id);
    await this.bannerRepository.softDelete(id);
    await this.homeChanges.record(
      CmsHomeChangeAction.BANNER_DELETED,
      banner.alt,
      actor,
    );
  }

  /**
   * Drops banners whose target left the public catalog (out of stock,
   * inactive, deleted). Works on rows and on published copies alike, so a
   * frozen home still hides a link that would now land on a 404.
   */
  async resolveVisibleBanners<T extends BannerTargetSource>(
    banners: T[],
  ): Promise<BannerView<T>[]> {
    const views = await this.resolveBannerTargets(banners);
    return views.filter(
      ({ banner, target }) =>
        (!banner.targetType && !banner.targetId) || target?.isAvailable,
    );
  }

  private async validateBannerTarget(
    target: CmsBannerTargetReference,
  ): Promise<void> {
    if (target.type === CmsBannerTargetType.PRODUCT) {
      const product = await this.productRepository.findOne({
        where: { id: target.id },
      });
      if (!product) {
        throw new NotFoundException(
          `Product banner target with id "${target.id}" not found`,
        );
      }
      return;
    }

    const category = await this.categoryRepository.findOne({
      where: { id: target.id },
    });
    if (!category) {
      throw new NotFoundException(
        `Taxonomy banner target with id "${target.id}" not found`,
      );
    }

    const isDepartment = category.parentId === null;
    if (
      (target.type === CmsBannerTargetType.DEPARTMENT && !isDepartment) ||
      (target.type === CmsBannerTargetType.CATEGORY && isDepartment)
    ) {
      throw new BadRequestException(
        `Taxonomy target "${target.id}" is not a ${target.type}`,
      );
    }
  }

  private async resolveBannerTargets<T extends BannerTargetSource>(
    banners: T[],
  ): Promise<BannerView<T>[]> {
    const categoryIds = this.targetIdsFor(
      banners,
      CmsBannerTargetType.CATEGORY,
    );
    const departmentIds = this.targetIdsFor(
      banners,
      CmsBannerTargetType.DEPARTMENT,
    );
    const taxonomyIds = [...new Set([...categoryIds, ...departmentIds])];
    const productIds = this.targetIdsFor(banners, CmsBannerTargetType.PRODUCT);

    const [
      taxonomy,
      products,
      availableProductStock,
      availableCategories,
      availableDepartments,
    ] = await Promise.all([
      taxonomyIds.length
        ? this.categoryRepository.find({
            where: { id: In(taxonomyIds) },
            withDeleted: true,
          })
        : Promise.resolve([]),
      productIds.length
        ? this.productRepository.find({
            where: { id: In(productIds) },
            withDeleted: true,
          })
        : Promise.resolve([]),
      productIds.length
        ? this.productsService.availableFor(productIds)
        : Promise.resolve(new Map<string, number>()),
      categoryIds.length
        ? this.categoriesService.listPublicCategories({})
        : Promise.resolve([]),
      departmentIds.length
        ? this.categoriesService.listPublicDepartments({})
        : Promise.resolve([]),
    ]);
    const taxonomyById = new Map(taxonomy.map((item) => [item.id, item]));
    const productsById = new Map(products.map((item) => [item.id, item]));
    const availableCategoryIds = new Set(
      availableCategories.map((item) => item.id),
    );
    const availableDepartmentIds = new Set(
      availableDepartments.map((item) => item.id),
    );

    return banners.map((banner) => ({
      banner,
      target: this.resolveBannerTarget(
        banner,
        taxonomyById,
        productsById,
        availableProductStock,
        availableCategoryIds,
        availableDepartmentIds,
      ),
    }));
  }

  private targetIdsFor(
    banners: BannerTargetSource[],
    targetType: CmsBannerTargetType,
  ): string[] {
    return [
      ...new Set(
        banners
          .filter(
            (banner) => banner.targetId && banner.targetType === targetType,
          )
          .map((banner) => banner.targetId as string),
      ),
    ];
  }

  private resolveBannerTarget(
    banner: BannerTargetSource,
    taxonomyById: Map<string, Category>,
    productsById: Map<string, Product>,
    availableProductStock: Map<string, number>,
    availableCategoryIds: Set<string>,
    availableDepartmentIds: Set<string>,
  ): CmsBannerResolvedTarget | null {
    if (!banner.targetType || !banner.targetId) return null;

    if (banner.targetType === CmsBannerTargetType.PRODUCT) {
      const product = productsById.get(banner.targetId);
      return {
        type: banner.targetType,
        id: banner.targetId,
        name: product?.name ?? null,
        slug: product?.slug ?? null,
        isAvailable: Boolean(
          product &&
          product.isActive &&
          product.deletedAt === null &&
          (availableProductStock.get(banner.targetId) ?? 0) > 0,
        ),
      };
    }

    const category = taxonomyById.get(banner.targetId);
    const matchesType =
      banner.targetType === CmsBannerTargetType.DEPARTMENT
        ? category?.parentId === null
        : category?.parentId != null;
    const isInPublicCatalog =
      banner.targetType === CmsBannerTargetType.DEPARTMENT
        ? availableDepartmentIds.has(banner.targetId)
        : availableCategoryIds.has(banner.targetId);
    return {
      type: banner.targetType,
      id: banner.targetId,
      name: category?.name ?? null,
      slug: category?.slug ?? null,
      isAvailable: Boolean(
        category &&
        matchesType &&
        category.isActive &&
        category.deletedAt === null &&
        isInPublicCatalog,
      ),
    };
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
    return conRedes(row?.data ?? DEFAULT_SITE_SETTINGS, DEFAULT_SITE_SETTINGS);
  }

  async updateSettings(dto: UpdateSiteSettingsDto): Promise<CmsSiteSettings> {
    const row =
      (await this.getSettingsRow()) ?? this.settingsRepository.create();
    row.data = dto;
    const saved = await this.settingsRepository.save(row);
    this.revalidationService.notify(CMS_REVALIDATE_TAGS);
    return saved;
  }
}
