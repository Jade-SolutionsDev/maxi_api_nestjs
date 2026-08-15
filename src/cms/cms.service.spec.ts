import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { RevalidationService } from '../revalidation/revalidation.service';
import { CmsService, DEFAULT_SITE_SETTINGS } from './cms.service';
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

type RepoMock = {
  find: jest.Mock;
  findOne: jest.Mock;
  create: jest.Mock;
  save: jest.Mock;
  softDelete: jest.Mock;
};

const makeRepo = (): RepoMock => ({
  find: jest.fn(),
  findOne: jest.fn(),
  create: jest.fn((input: unknown) => input),
  save: jest.fn((input: unknown) => Promise.resolve(input)),
  softDelete: jest.fn(),
});

describe('CmsService', () => {
  let service: CmsService;
  let pageRepo: RepoMock;
  let bannerRepo: RepoMock;
  let settingsRepo: RepoMock;
  let revalidation: { notify: jest.Mock };

  beforeEach(async () => {
    pageRepo = makeRepo();
    bannerRepo = makeRepo();
    settingsRepo = makeRepo();
    revalidation = { notify: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CmsService,
        { provide: getRepositoryToken(CmsPage), useValue: pageRepo },
        { provide: getRepositoryToken(CmsBanner), useValue: bannerRepo },
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

    it('suffixes the slug when it already exists (soft-deleted included)', async () => {
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

    it('soft-deletes and notifies on remove', async () => {
      pageRepo.findOne.mockResolvedValue(makePage());

      await service.removePage('page-1');

      expect(pageRepo.softDelete).toHaveBeenCalledWith('page-1');
      expect(revalidation.notify).toHaveBeenCalledWith(['cms']);
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
