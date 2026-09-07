import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { RevalidationService } from '../revalidation/revalidation.service';
import { CategoriesService } from '../categories/categories.service';
import { Category } from '../categories/entities/category.entity';
import { Product } from '../products/entities/product.entity';
import { ProductsService } from '../products/products.service';
import { CmsService, DEFAULT_SITE_SETTINGS } from './cms.service';
import { CmsBannerTargetType } from './cms-banner.types';
import { CmsBanner } from './entities/cms-banner.entity';
import { CmsPage } from './entities/cms-page.entity';
import { CmsService as CmsServiceEntity } from './entities/cms-service.entity';
import { CmsSiteSettings } from './entities/cms-site-settings.entity';
import { CmsStaffMember } from './entities/cms-staff-member.entity';

const makePage = (overrides: Partial<CmsPage> = {}): CmsPage => ({
  id: 'page-1',
  slug: 'politica-de-privacidad',
  title: 'Política de privacidad',
  content: '# Política',
  sortOrder: 0,
  isActive: true,
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
  deletedAt: null,
  ...overrides,
});

const makeBanner = (overrides: Partial<CmsBanner> = {}): CmsBanner => ({
  id: '11111111-1111-4111-8111-111111111111',
  alt: 'Oferta semanal',
  desktop: { src: '/desktop.webp', width: 1600, height: 500 },
  tablet: { src: '/tablet.webp', width: 1024, height: 420 },
  mobile: { src: '/mobile.webp', width: 640, height: 480 },
  targetType: null,
  targetId: null,
  sortOrder: 0,
  isActive: true,
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
  deletedAt: null,
  ...overrides,
});

const bannerInput = {
  alt: 'Oferta semanal',
  desktop: { src: '/desktop.webp', width: 1600, height: 500 },
  tablet: { src: '/tablet.webp', width: 1024, height: 420 },
  mobile: { src: '/mobile.webp', width: 640, height: 480 },
};

type RepoMock = {
  find: jest.Mock;
  findOne: jest.Mock;
  create: jest.Mock;
  save: jest.Mock;
  update: jest.Mock;
  softDelete: jest.Mock;
};

const makeRepo = (): RepoMock => ({
  find: jest.fn(),
  findOne: jest.fn(),
  create: jest.fn((input: unknown) => input),
  save: jest.fn((input: unknown) => Promise.resolve(input)),
  update: jest.fn(),
  softDelete: jest.fn(),
});

describe('CmsService', () => {
  let service: CmsService;
  let pageRepo: RepoMock;
  let bannerRepo: RepoMock;
  let categoryRepo: RepoMock;
  let productRepo: RepoMock;
  let settingsRepo: RepoMock;
  let categoriesService: {
    listPublicCategories: jest.Mock;
    listPublicDepartments: jest.Mock;
  };
  let productsService: { availableFor: jest.Mock };
  let revalidation: { notify: jest.Mock };

  beforeEach(async () => {
    pageRepo = makeRepo();
    bannerRepo = makeRepo();
    categoryRepo = makeRepo();
    productRepo = makeRepo();
    settingsRepo = makeRepo();
    categoriesService = {
      listPublicCategories: jest.fn().mockResolvedValue([]),
      listPublicDepartments: jest.fn().mockResolvedValue([]),
    };
    productsService = {
      availableFor: jest.fn().mockResolvedValue(new Map()),
    };
    revalidation = { notify: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CmsService,
        { provide: getRepositoryToken(CmsPage), useValue: pageRepo },
        { provide: getRepositoryToken(CmsBanner), useValue: bannerRepo },
        { provide: getRepositoryToken(Category), useValue: categoryRepo },
        { provide: getRepositoryToken(Product), useValue: productRepo },
        { provide: CategoriesService, useValue: categoriesService },
        { provide: ProductsService, useValue: productsService },
        { provide: getRepositoryToken(CmsServiceEntity), useValue: makeRepo() },
        { provide: getRepositoryToken(CmsStaffMember), useValue: makeRepo() },
        {
          provide: getRepositoryToken(CmsSiteSettings),
          useValue: settingsRepo,
        },
        { provide: RevalidationService, useValue: revalidation },
      ],
    }).compile();

    service = module.get<CmsService>(CmsService);
  });

  describe('pages', () => {
    it('derives a unique slug from the title on create', async () => {
      pageRepo.findOne.mockResolvedValue(null);

      await service.createPage({
        title: 'Política de privacidad',
        content: 'cuerpo',
      });

      expect(pageRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ slug: 'politica-de-privacidad' }),
      );
      expect(revalidation.notify).toHaveBeenCalledWith(['cms']);
    });

    it('suffixes the slug when an ACTIVE page already owns it', async () => {
      pageRepo.findOne
        .mockResolvedValueOnce(makePage())
        .mockResolvedValueOnce(null);

      await service.createPage({
        title: 'Política de privacidad',
        content: 'cuerpo',
      });

      expect(pageRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ slug: 'politica-de-privacidad-2' }),
      );
      expect(pageRepo.findOne).toHaveBeenCalledWith(
        expect.objectContaining({ withDeleted: true }),
      );
    });

    it('reclaims a slug held by a soft-deleted leftover row', async () => {
      pageRepo.findOne.mockResolvedValueOnce(
        makePage({ id: 'old-1', deletedAt: new Date('2026-02-01') }),
      );

      await service.createPage({
        title: 'Política de privacidad',
        content: 'cuerpo',
      });

      expect(pageRepo.update).toHaveBeenCalledWith('old-1', {
        slug: expect.stringMatching(
          /^politica-de-privacidad-eliminada-\d+$/,
        ) as string,
      });
      expect(pageRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ slug: 'politica-de-privacidad' }),
      );
    });

    it('public slug lookup only returns active pages', async () => {
      pageRepo.findOne.mockResolvedValue(null);

      await expect(
        service.getPageBySlugPublic('politica-de-privacidad'),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(pageRepo.findOne).toHaveBeenCalledWith({
        where: { slug: 'politica-de-privacidad', isActive: true },
      });
    });

    it('public list filters to active pages', async () => {
      pageRepo.find.mockResolvedValue([]);

      await service.listPagesPublic();

      expect(pageRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({ where: { isActive: true } }),
      );
    });

    it('frees the slug, soft-deletes and notifies on remove', async () => {
      pageRepo.findOne.mockResolvedValue(makePage());

      await service.removePage('page-1');

      expect(pageRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          slug: expect.stringMatching(
            /^politica-de-privacidad-eliminada-\d+$/,
          ) as string,
        }),
      );
      expect(pageRepo.softDelete).toHaveBeenCalledWith('page-1');
      expect(revalidation.notify).toHaveBeenCalledWith(['cms']);
    });

    it('reuses the original slug after a delete + recreate cycle', async () => {
      pageRepo.findOne.mockResolvedValue(null);

      await service.createPage({
        title: 'Términos y condiciones',
        content: 'cuerpo',
      });

      expect(pageRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ slug: 'terminos-y-condiciones' }),
      );
    });
  });

  describe('banners', () => {
    it('public list filters to active banners in display order', async () => {
      bannerRepo.find.mockResolvedValue([]);

      await service.listBannersPublic();

      expect(bannerRepo.find).toHaveBeenCalledWith({
        where: { isActive: true },
        order: { sortOrder: 'ASC', createdAt: 'ASC' },
      });
    });

    it('stores a stable typed department reference while allowing inactive targets', async () => {
      const departmentId = '22222222-2222-4222-8222-222222222222';
      categoryRepo.findOne.mockResolvedValue({
        id: departmentId,
        parentId: null,
        isActive: false,
      });
      categoryRepo.find.mockResolvedValue([
        {
          id: departmentId,
          parentId: null,
          name: 'Alimentos',
          slug: 'alimentos-renombrados',
          isActive: false,
          deletedAt: null,
        },
      ]);
      bannerRepo.save.mockImplementation((banner) =>
        Promise.resolve(makeBanner(banner as Partial<CmsBanner>)),
      );

      const result = await service.createBanner({
        ...bannerInput,
        target: { type: CmsBannerTargetType.DEPARTMENT, id: departmentId },
      });

      expect(bannerRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          targetType: CmsBannerTargetType.DEPARTMENT,
          targetId: departmentId,
        }),
      );
      expect(result.target).toEqual({
        type: CmsBannerTargetType.DEPARTMENT,
        id: departmentId,
        name: 'Alimentos',
        slug: 'alimentos-renombrados',
        isAvailable: false,
      });
    });

    it.each([
      {
        type: CmsBannerTargetType.CATEGORY,
        id: '55555555-5555-4555-8555-555555555555',
        entity: {
          id: '55555555-5555-4555-8555-555555555555',
          parentId: '22222222-2222-4222-8222-222222222222',
          name: 'Arroces',
          slug: 'arroces',
          isActive: true,
          deletedAt: null,
        },
      },
      {
        type: CmsBannerTargetType.PRODUCT,
        id: '33333333-3333-4333-8333-333333333333',
        entity: {
          id: '33333333-3333-4333-8333-333333333333',
          name: 'Arroz Selecto',
          slug: 'arroz-selecto',
          isActive: true,
          deletedAt: null,
        },
      },
    ])('accepts an existing $type target', async ({ type, id, entity }) => {
      const repository =
        type === CmsBannerTargetType.PRODUCT ? productRepo : categoryRepo;
      repository.findOne.mockResolvedValue(entity);
      repository.find.mockResolvedValue([entity]);
      if (type === CmsBannerTargetType.PRODUCT) {
        productsService.availableFor.mockResolvedValue(new Map([[id, 5]]));
      } else {
        categoriesService.listPublicCategories.mockResolvedValue([entity]);
      }
      bannerRepo.save.mockImplementation((value) =>
        Promise.resolve(makeBanner(value as Partial<CmsBanner>)),
      );

      const result = await service.createBanner({
        ...bannerInput,
        target: { type, id },
      });

      expect(result.target).toEqual(
        expect.objectContaining({ type, id, slug: entity.slug }),
      );
      expect(result.target?.isAvailable).toBe(true);
    });

    it('rejects using a department id as a category target', async () => {
      const departmentId = '22222222-2222-4222-8222-222222222222';
      categoryRepo.findOne.mockResolvedValue({
        id: departmentId,
        parentId: null,
      });

      await expect(
        service.createBanner({
          ...bannerInput,
          target: { type: CmsBannerTargetType.CATEGORY, id: departmentId },
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(bannerRepo.save).not.toHaveBeenCalled();
    });

    it('rejects a target id that does not exist', async () => {
      productRepo.findOne.mockResolvedValue(null);

      await expect(
        service.createBanner({
          ...bannerInput,
          target: {
            type: CmsBannerTargetType.PRODUCT,
            id: '33333333-3333-4333-8333-333333333333',
          },
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(bannerRepo.save).not.toHaveBeenCalled();
    });

    it('preserves an existing target when patch omits target', async () => {
      const productId = '33333333-3333-4333-8333-333333333333';
      bannerRepo.findOne.mockResolvedValue(
        makeBanner({
          targetType: CmsBannerTargetType.PRODUCT,
          targetId: productId,
        }),
      );
      productRepo.find.mockResolvedValue([
        {
          id: productId,
          name: 'Arroz',
          slug: 'arroz',
          isActive: true,
          deletedAt: null,
        },
      ]);

      const result = await service.updateBanner(makeBanner().id, {
        alt: 'Oferta actualizada',
      });

      expect(bannerRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          targetType: CmsBannerTargetType.PRODUCT,
          targetId: productId,
        }),
      );
      expect(result.target?.id).toBe(productId);
    });

    it('clears an existing target when patch receives target null', async () => {
      bannerRepo.findOne.mockResolvedValue(
        makeBanner({
          targetType: CmsBannerTargetType.PRODUCT,
          targetId: '33333333-3333-4333-8333-333333333333',
        }),
      );

      const result = await service.updateBanner(makeBanner().id, {
        target: null,
      });

      expect(bannerRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ targetType: null, targetId: null }),
      );
      expect(result.target).toBeNull();
    });

    it('resolves the current slug in batches instead of keeping a snapshot', async () => {
      const productId = '33333333-3333-4333-8333-333333333333';
      bannerRepo.find.mockResolvedValue([
        makeBanner({
          id: '11111111-1111-4111-8111-111111111111',
          targetType: CmsBannerTargetType.PRODUCT,
          targetId: productId,
        }),
        makeBanner({
          id: '44444444-4444-4444-8444-444444444444',
          targetType: CmsBannerTargetType.PRODUCT,
          targetId: productId,
        }),
      ]);
      productRepo.find.mockResolvedValue([
        {
          id: productId,
          name: 'Arroz Selecto',
          slug: 'arroz-selecto-nuevo',
          isActive: true,
          deletedAt: null,
        },
      ]);
      productsService.availableFor.mockResolvedValue(new Map([[productId, 8]]));

      const result = await service.listBannersPublic();

      expect(productRepo.find).toHaveBeenCalledTimes(1);
      expect(result.map((item) => item.target?.slug)).toEqual([
        'arroz-selecto-nuevo',
        'arroz-selecto-nuevo',
      ]);
    });

    it('hides a linked product banner while global sellable stock is zero', async () => {
      const productId = '33333333-3333-4333-8333-333333333333';
      const unlinked = makeBanner();
      const linked = makeBanner({
        id: '44444444-4444-4444-8444-444444444444',
        targetType: CmsBannerTargetType.PRODUCT,
        targetId: productId,
      });
      bannerRepo.find.mockResolvedValue([unlinked, linked]);
      productRepo.find.mockResolvedValue([
        {
          id: productId,
          name: 'Arroz',
          slug: 'arroz',
          isActive: true,
          deletedAt: null,
        },
      ]);
      productsService.availableFor.mockResolvedValue(new Map([[productId, 0]]));

      const result = await service.listBannersPublic();

      expect(result.map(({ banner }) => banner.id)).toEqual([unlinked.id]);
    });

    it('shows the same product banner again when sellable stock returns', async () => {
      const productId = '33333333-3333-4333-8333-333333333333';
      const linked = makeBanner({
        targetType: CmsBannerTargetType.PRODUCT,
        targetId: productId,
      });
      bannerRepo.find.mockResolvedValue([linked]);
      productRepo.find.mockResolvedValue([
        {
          id: productId,
          name: 'Arroz',
          slug: 'arroz',
          isActive: true,
          deletedAt: null,
        },
      ]);
      productsService.availableFor.mockResolvedValue(new Map([[productId, 3]]));

      const result = await service.listBannersPublic();

      expect(result.map(({ banner }) => banner.id)).toEqual([linked.id]);
    });

    it('hides category and department banners excluded from the public catalog', async () => {
      const category = {
        id: '55555555-5555-4555-8555-555555555555',
        parentId: '22222222-2222-4222-8222-222222222222',
        name: 'Arroces',
        slug: 'arroces',
        isActive: true,
        deletedAt: null,
      };
      const department = {
        id: '22222222-2222-4222-8222-222222222222',
        parentId: null,
        name: 'Alimentos',
        slug: 'alimentos',
        isActive: true,
        deletedAt: null,
      };
      bannerRepo.find.mockResolvedValue([
        makeBanner({
          targetType: CmsBannerTargetType.CATEGORY,
          targetId: category.id,
        }),
        makeBanner({
          id: '44444444-4444-4444-8444-444444444444',
          targetType: CmsBannerTargetType.DEPARTMENT,
          targetId: department.id,
        }),
      ]);
      categoryRepo.find.mockResolvedValue([category, department]);

      const result = await service.listBannersPublic();

      expect(result).toHaveLength(0);
    });

    it('shows category and department banners included in the public catalog', async () => {
      const category = {
        id: '55555555-5555-4555-8555-555555555555',
        parentId: '22222222-2222-4222-8222-222222222222',
        name: 'Arroces',
        slug: 'arroces',
        isActive: true,
        deletedAt: null,
      };
      const department = {
        id: '22222222-2222-4222-8222-222222222222',
        parentId: null,
        name: 'Alimentos',
        slug: 'alimentos',
        isActive: true,
        deletedAt: null,
      };
      bannerRepo.find.mockResolvedValue([
        makeBanner({
          targetType: CmsBannerTargetType.CATEGORY,
          targetId: category.id,
        }),
        makeBanner({
          id: '44444444-4444-4444-8444-444444444444',
          targetType: CmsBannerTargetType.DEPARTMENT,
          targetId: department.id,
        }),
      ]);
      categoryRepo.find.mockResolvedValue([category, department]);
      categoriesService.listPublicCategories.mockResolvedValue([category]);
      categoriesService.listPublicDepartments.mockResolvedValue([department]);

      const result = await service.listBannersPublic();

      expect(result.map(({ banner }) => banner.id)).toEqual([
        '11111111-1111-4111-8111-111111111111',
        '44444444-4444-4444-8444-444444444444',
      ]);
    });
  });

  describe('settings', () => {
    it('falls back to the defaults when no row exists', async () => {
      settingsRepo.find.mockResolvedValue([]);

      await expect(service.getSettings()).resolves.toEqual(
        DEFAULT_SITE_SETTINGS,
      );
    });

    it('creates the row on first update and notifies', async () => {
      settingsRepo.find.mockResolvedValue([]);
      settingsRepo.create.mockReturnValue({});

      await service.updateSettings(DEFAULT_SITE_SETTINGS);

      expect(settingsRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ data: DEFAULT_SITE_SETTINGS }),
      );
      expect(revalidation.notify).toHaveBeenCalledWith(['cms']);
    });

    it('overwrites the existing row on later updates', async () => {
      const existing = { id: 'row-1', data: DEFAULT_SITE_SETTINGS };
      settingsRepo.find.mockResolvedValue([existing]);
      const next = {
        ...DEFAULT_SITE_SETTINGS,
        payments: { visa: false, mastercard: true, mibilletera: true },
      };

      await service.updateSettings(next);

      expect(settingsRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'row-1', data: next }),
      );
      expect(settingsRepo.create).not.toHaveBeenCalled();
    });
  });
});
