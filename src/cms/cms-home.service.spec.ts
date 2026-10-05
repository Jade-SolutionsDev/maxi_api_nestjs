import {
  BadRequestException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Category } from '../categories/entities/category.entity';
import { Product } from '../products/entities/product.entity';
import { RevalidationService } from '../revalidation/revalidation.service';
import type { User } from '../users/entities/user.entity';
import { CmsService } from './cms.service';
import { CmsHomeChangesService } from './cms-home-changes.service';
import { verifyHomePreviewToken } from './cms-home-preview-token';
import { buildHomeSnapshot, DEFAULT_HOME_LAYOUT } from './cms-home.layout';
import { CmsHomeService } from './cms-home.service';
import { CmsHomeChangeAction, HomeSectionKey } from './cms-home.types';
import type { HomeLayout } from './cms-home.types';
import { CmsBanner } from './entities/cms-banner.entity';
import { CmsHome } from './entities/cms-home.entity';

const P1 = '11111111-1111-4111-8111-111111111111';
const P2 = '22222222-2222-4222-8222-222222222222';
const D1 = '33333333-3333-4333-8333-333333333333';

const actor = {
  id: 'user-1',
  firstName: 'Ana',
  lastName: 'Pérez',
  email: 'ana@maxi.cu',
} as User;

const makeBanner = (overrides: Partial<CmsBanner> = {}): CmsBanner => ({
  id: 'banner-1',
  alt: 'Oferta semanal',
  title: null,
  subtitle: null,
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

const makeHome = (overrides: Partial<CmsHome> = {}): CmsHome => ({
  id: 'home-1',
  draft: DEFAULT_HOME_LAYOUT,
  published: null,
  draftUpdatedAt: null,
  draftUpdatedBy: null,
  publishedAt: null,
  publishedBy: null,
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
  ...overrides,
});

const reversedLayout: HomeLayout = {
  ...DEFAULT_HOME_LAYOUT,
  sections: [...DEFAULT_HOME_LAYOUT.sections].reverse(),
};

type RepoMock = {
  find: jest.Mock;
  create: jest.Mock;
  save: jest.Mock;
};

const makeRepo = (): RepoMock => ({
  find: jest.fn().mockResolvedValue([]),
  create: jest.fn((input: unknown) => ({ ...(input as object) })),
  save: jest.fn((input: unknown) => Promise.resolve(input)),
});

describe('CmsHomeService', () => {
  let service: CmsHomeService;
  let homeRepo: RepoMock;
  let bannerRepo: RepoMock;
  let productRepo: RepoMock;
  let categoryRepo: RepoMock;
  let cmsService: { resolveVisibleBanners: jest.Mock };
  let changes: { record: jest.Mock };
  let revalidation: { notify: jest.Mock };
  let storefront: { url?: string; revalidateSecret?: string };

  beforeEach(async () => {
    homeRepo = makeRepo();
    bannerRepo = makeRepo();
    productRepo = makeRepo();
    categoryRepo = makeRepo();
    cmsService = {
      resolveVisibleBanners: jest.fn((banners: unknown[]) =>
        Promise.resolve(banners.map((banner) => ({ banner, target: null }))),
      ),
    };
    changes = { record: jest.fn().mockResolvedValue(undefined) };
    revalidation = { notify: jest.fn() };
    storefront = {
      url: 'https://tienda.maxi.cu',
      revalidateSecret: 'dev-revalidate-secret',
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CmsHomeService,
        { provide: getRepositoryToken(CmsHome), useValue: homeRepo },
        { provide: getRepositoryToken(CmsBanner), useValue: bannerRepo },
        { provide: getRepositoryToken(Product), useValue: productRepo },
        { provide: getRepositoryToken(Category), useValue: categoryRepo },
        { provide: CmsService, useValue: cmsService },
        { provide: CmsHomeChangesService, useValue: changes },
        { provide: RevalidationService, useValue: revalidation },
        {
          provide: ConfigService,
          useValue: { get: jest.fn(() => storefront) },
        },
      ],
    }).compile();

    service = module.get(CmsHomeService);
  });

  describe('editor state', () => {
    it('starts from the default layout and flags a home that was never published', async () => {
      const state = await service.getEditorState();

      expect(state).toEqual({
        layout: DEFAULT_HOME_LAYOUT,
        updatedAt: null,
        updatedBy: null,
        publishedAt: null,
        publishedBy: null,
        hasUnpublishedChanges: true,
      });
    });

    it('reports no pending changes while the draft matches what is live', async () => {
      const banner = makeBanner();
      homeRepo.find.mockResolvedValue([
        makeHome({
          published: buildHomeSnapshot(DEFAULT_HOME_LAYOUT, [banner]),
          publishedAt: new Date('2026-09-01'),
          publishedBy: 'Ana Pérez',
        }),
      ]);
      bannerRepo.find.mockResolvedValue([banner]);

      const state = await service.getEditorState();

      expect(state.hasUnpublishedChanges).toBe(false);
      expect(state.publishedBy).toBe('Ana Pérez');
    });

    it('reports pending changes when a banner was edited after publishing', async () => {
      homeRepo.find.mockResolvedValue([
        makeHome({
          published: buildHomeSnapshot(DEFAULT_HOME_LAYOUT, [makeBanner()]),
        }),
      ]);
      bannerRepo.find.mockResolvedValue([makeBanner({ alt: 'Nueva oferta' })]);

      const state = await service.getEditorState();

      expect(state.hasUnpublishedChanges).toBe(true);
    });

    it('builds the draft from active banners only, in display order', async () => {
      await service.getEditorState();

      expect(bannerRepo.find).toHaveBeenCalledWith({
        where: { isActive: true },
        order: { sortOrder: 'ASC', createdAt: 'ASC' },
      });
    });
  });

  describe('updateLayout', () => {
    it('saves the normalized draft with its author and date, and logs the change', async () => {
      homeRepo.find.mockResolvedValue([makeHome()]);
      productRepo.find.mockResolvedValue([{ id: P1 }, { id: P2 }]);
      categoryRepo.find.mockResolvedValue([{ id: D1, parentId: null }]);

      const state = await service.updateLayout(
        {
          sections: reversedLayout.sections,
          featuredProductIds: [P2, P1, P2],
          featuredDepartmentIds: [D1],
        },
        actor,
      );

      const saved = homeRepo.save.mock.calls[0][0] as CmsHome;
      expect(saved.draft.sections[0].key).toBe(HomeSectionKey.RECENT_PRODUCTS);
      expect(saved.draft.featuredProductIds).toEqual([P2, P1]);
      expect(saved.draftUpdatedBy).toBe('Ana Pérez');
      expect(saved.draftUpdatedAt).toBeInstanceOf(Date);
      expect(state.updatedBy).toBe('Ana Pérez');
      expect(changes.record).toHaveBeenCalledWith(
        CmsHomeChangeAction.LAYOUT_UPDATED,
        null,
        actor,
      );
    });

    it('does not touch the live store', async () => {
      homeRepo.find.mockResolvedValue([makeHome()]);

      await service.updateLayout(reversedLayout, actor);

      expect(revalidation.notify).not.toHaveBeenCalled();
    });

    it('creates the home row on the first save', async () => {
      await service.updateLayout(reversedLayout, actor);

      expect(homeRepo.create).toHaveBeenCalled();
      expect(homeRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ published: null }),
      );
    });

    it('rejects a featured product that does not exist', async () => {
      productRepo.find.mockResolvedValue([{ id: P1 }]);

      await expect(
        service.updateLayout(
          { ...DEFAULT_HOME_LAYOUT, featuredProductIds: [P1, P2] },
          actor,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(homeRepo.save).not.toHaveBeenCalled();
    });

    it('rejects a category picked as a featured department', async () => {
      categoryRepo.find.mockResolvedValue([{ id: D1, parentId: P1 }]);

      await expect(
        service.updateLayout(
          { ...DEFAULT_HOME_LAYOUT, featuredDepartmentIds: [D1] },
          actor,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('publish', () => {
    it('freezes the draft and the active banners, signs it and refreshes the store', async () => {
      const banner = makeBanner({ alt: 'Vuelta a clases' });
      homeRepo.find.mockResolvedValue([makeHome({ draft: reversedLayout })]);
      bannerRepo.find.mockResolvedValue([banner]);

      const state = await service.publish(actor);

      const saved = homeRepo.save.mock.calls[0][0] as CmsHome;
      expect(saved.published).toEqual(
        buildHomeSnapshot(reversedLayout, [banner]),
      );
      expect(saved.publishedBy).toBe('Ana Pérez');
      expect(saved.publishedAt).toBeInstanceOf(Date);
      expect(state.hasUnpublishedChanges).toBe(false);
      expect(changes.record).toHaveBeenCalledWith(
        CmsHomeChangeAction.PUBLISHED,
        null,
        actor,
      );
      expect(revalidation.notify).toHaveBeenCalledWith(['cms']);
    });
  });

  describe('public home', () => {
    it('serves the published snapshot, not the banners being edited', async () => {
      const published = buildHomeSnapshot(reversedLayout, [
        makeBanner({ alt: 'Publicado' }),
      ]);
      homeRepo.find.mockResolvedValue([makeHome({ published })]);

      const home = await service.getPublishedHome();

      expect(bannerRepo.find).not.toHaveBeenCalled();
      expect(home.layout.sections).toEqual(reversedLayout.sections);
      expect(cmsService.resolveVisibleBanners).toHaveBeenCalledWith(
        published.banners,
      );
      expect(home.banners.map(({ banner }) => banner.alt)).toEqual([
        'Publicado',
      ]);
    });

    it('shows the default home when nothing was ever published', async () => {
      const home = await service.getPublishedHome();

      expect(home.layout).toEqual(DEFAULT_HOME_LAYOUT);
      expect(home.banners).toEqual([]);
    });

    it('previews the draft layout with the banners being edited', async () => {
      homeRepo.find.mockResolvedValue([makeHome({ draft: reversedLayout })]);
      bannerRepo.find.mockResolvedValue([makeBanner({ alt: 'Borrador' })]);

      const home = await service.getDraftHome();

      expect(home.layout.sections).toEqual(reversedLayout.sections);
      expect(home.banners.map(({ banner }) => banner.alt)).toEqual([
        'Borrador',
      ]);
    });
  });

  describe('preview access', () => {
    it('links to the storefront preview route with a token it can verify', () => {
      const now = new Date('2026-09-30T12:00:00Z');

      const link = service.createPreviewLink(now);

      const url = new URL(link.url);
      expect(`${url.origin}${url.pathname}`).toBe(
        'https://tienda.maxi.cu/api/vista-previa',
      );
      expect(link.expiresAt).toEqual(new Date('2026-09-30T12:30:00Z'));
      expect(
        verifyHomePreviewToken(
          'dev-revalidate-secret',
          url.searchParams.get('token') ?? '',
          now,
        ),
      ).toBe(true);
    });

    it('refuses to build a link while the storefront is not configured', () => {
      storefront = { url: undefined, revalidateSecret: undefined };

      expect(() => service.createPreviewLink()).toThrow(
        ServiceUnavailableException,
      );
    });

    it('lets the storefront read the draft only with the shared secret', () => {
      expect(() =>
        service.assertStorefrontSecret('dev-revalidate-secret'),
      ).not.toThrow();
      expect(() => service.assertStorefrontSecret('guess')).toThrow(
        UnauthorizedException,
      );
      expect(() => service.assertStorefrontSecret(undefined)).toThrow(
        UnauthorizedException,
      );
    });

    it('keeps the draft closed when no secret is configured', () => {
      storefront = { url: 'https://tienda.maxi.cu', revalidateSecret: '' };

      expect(() => service.assertStorefrontSecret('')).toThrow(
        UnauthorizedException,
      );
    });
  });
});
