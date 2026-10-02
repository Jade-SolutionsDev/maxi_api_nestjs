import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { IsNull, LessThanOrEqual, MoreThan, Not, Or } from 'typeorm';
import { RevalidationService } from '../revalidation/revalidation.service';
import type { User } from '../users/entities/user.entity';
import { CmsPagesService } from './cms-pages.service';
import { CmsPage, CmsPageKind } from './entities/cms-page.entity';
import { CmsPageVersion } from './entities/cms-page-version.entity';

const makeVersion = (
  overrides: Partial<CmsPageVersion> = {},
): CmsPageVersion => ({
  id: 'version-1',
  pageId: 'page-1',
  version: 1,
  title: 'Política de privacidad',
  content: '# Política',
  publishedById: 'user-1',
  publishedByName: 'Ana Pérez',
  publishedAt: new Date('2026-01-01'),
  ...overrides,
});

const makePage = (overrides: Partial<CmsPage> = {}): CmsPage => ({
  id: 'page-1',
  kind: CmsPageKind.PAGE,
  slug: 'politica-de-privacidad',
  title: 'Política de privacidad',
  content: '# Política',
  sortOrder: 0,
  isActive: true,
  startsAt: null,
  endsAt: null,
  draftUpdatedAt: null,
  draftUpdatedBy: null,
  publishedVersionId: null,
  publishedVersion: null,
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
  deletedAt: null,
  ...overrides,
});

const publishedPage = (overrides: Partial<CmsPage> = {}): CmsPage => {
  const version = makeVersion();
  return makePage({
    publishedVersionId: version.id,
    publishedVersion: version,
    ...overrides,
  });
};

const actor = {
  id: 'user-1',
  firstName: 'Ana',
  lastName: 'Pérez',
} as User;

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

describe('CmsPagesService', () => {
  let service: CmsPagesService;
  let pageRepo: RepoMock;
  let versionRepo: RepoMock;
  let revalidation: { notify: jest.Mock };

  beforeEach(async () => {
    pageRepo = makeRepo();
    versionRepo = makeRepo();
    versionRepo.save.mockImplementation((input: Partial<CmsPageVersion>) =>
      Promise.resolve({
        id: 'version-new',
        publishedAt: new Date('2026-09-30'),
        ...input,
      }),
    );
    revalidation = { notify: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CmsPagesService,
        { provide: getRepositoryToken(CmsPage), useValue: pageRepo },
        { provide: getRepositoryToken(CmsPageVersion), useValue: versionRepo },
        { provide: RevalidationService, useValue: revalidation },
      ],
    }).compile();

    service = module.get(CmsPagesService);
  });

  describe('drafts', () => {
    it('creates the text as a draft the store does not see yet', async () => {
      pageRepo.findOne.mockResolvedValue(null);

      const page = await service.create(
        CmsPageKind.PAGE,
        { title: 'Política de privacidad', content: 'cuerpo' },
        actor,
      );

      expect(page).toEqual(
        expect.objectContaining({
          kind: CmsPageKind.PAGE,
          slug: 'politica-de-privacidad',
          title: 'Política de privacidad',
          content: 'cuerpo',
          draftUpdatedBy: 'Ana Pérez',
          publishedVersionId: null,
        }),
      );
      expect(revalidation.notify).not.toHaveBeenCalled();
    });

    it('suffixes the slug when an ACTIVE page already owns it', async () => {
      pageRepo.findOne
        .mockResolvedValueOnce(makePage())
        .mockResolvedValueOnce(null);

      await service.create(
        CmsPageKind.PAGE,
        { title: 'Política de privacidad', content: 'cuerpo' },
        actor,
      );

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

      await service.create(
        CmsPageKind.PAGE,
        { title: 'Política de privacidad', content: 'cuerpo' },
        actor,
      );

      expect(pageRepo.update).toHaveBeenCalledWith('old-1', {
        slug: expect.stringMatching(
          /^politica-de-privacidad-eliminada-\d+$/,
        ) as string,
      });
      expect(pageRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ slug: 'politica-de-privacidad' }),
      );
    });

    it('keeps an info page off any schedule', async () => {
      pageRepo.findOne.mockResolvedValue(null);

      const page = await service.create(
        CmsPageKind.PAGE,
        {
          title: 'Términos y condiciones',
          content: 'cuerpo',
          startsAt: '2026-10-01T00:00:00.000Z',
        },
        actor,
      );

      expect(page.startsAt).toBeNull();
    });

    it('schedules a home notice', async () => {
      pageRepo.findOne.mockResolvedValue(null);

      const page = await service.create(
        CmsPageKind.HOME_NOTICE,
        {
          title: 'Cerrado el 10 de octubre',
          content: 'No hacemos entregas ese día.',
          startsAt: '2026-10-07T00:00:00.000Z',
          endsAt: '2026-10-11T00:00:00.000Z',
        },
        actor,
      );

      expect(page.kind).toBe(CmsPageKind.HOME_NOTICE);
      expect(page.startsAt).toEqual(new Date('2026-10-07T00:00:00.000Z'));
      expect(page.endsAt).toEqual(new Date('2026-10-11T00:00:00.000Z'));
    });

    it('rejects a notice that ends before it starts', async () => {
      pageRepo.findOne.mockResolvedValue(null);

      await expect(
        service.create(
          CmsPageKind.HOME_NOTICE,
          {
            title: 'Aviso',
            content: 'texto',
            startsAt: '2026-10-11T00:00:00.000Z',
            endsAt: '2026-10-07T00:00:00.000Z',
          },
          actor,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(pageRepo.save).not.toHaveBeenCalled();
    });

    it('editing the text only touches the draft and records who did it', async () => {
      pageRepo.findOne.mockResolvedValue(publishedPage());

      const page = await service.update(
        CmsPageKind.PAGE,
        'page-1',
        { content: '# Política nueva' },
        actor,
      );

      expect(page.content).toBe('# Política nueva');
      expect(page.publishedVersion?.content).toBe('# Política');
      expect(page.draftUpdatedBy).toBe('Ana Pérez');
      expect(page.draftUpdatedAt).toBeInstanceOf(Date);
      expect(revalidation.notify).not.toHaveBeenCalled();
    });

    it('saving the whole form with the same settings leaves the store alone', async () => {
      pageRepo.findOne.mockResolvedValue(publishedPage());

      await service.update(
        CmsPageKind.PAGE,
        'page-1',
        {
          title: 'Política de privacidad',
          slug: 'politica-de-privacidad',
          content: '# Política revisada',
          sortOrder: 0,
          isActive: true,
        },
        actor,
      );

      expect(revalidation.notify).not.toHaveBeenCalled();
    });

    it('hiding a published page reaches the store right away', async () => {
      pageRepo.findOne.mockResolvedValue(publishedPage());

      await service.update(
        CmsPageKind.PAGE,
        'page-1',
        { isActive: false },
        actor,
      );

      expect(revalidation.notify).toHaveBeenCalledWith(['cms']);
    });

    it('looks pages up within their own kind', async () => {
      pageRepo.findOne.mockResolvedValue(null);

      await expect(
        service.get(CmsPageKind.HOME_NOTICE, 'page-1'),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(pageRepo.findOne).toHaveBeenCalledWith({
        where: { id: 'page-1', kind: CmsPageKind.HOME_NOTICE },
        relations: { publishedVersion: true },
      });
    });

    it('lists only the requested kind for the backoffice', async () => {
      pageRepo.find.mockResolvedValue([]);

      await service.listAdmin(CmsPageKind.HOME_NOTICE);

      expect(pageRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { kind: CmsPageKind.HOME_NOTICE },
          relations: { publishedVersion: true },
        }),
      );
    });
  });

  describe('publishing', () => {
    it('freezes the draft as version 1 and tells the store', async () => {
      pageRepo.findOne.mockResolvedValue(makePage());

      const page = await service.publish(CmsPageKind.PAGE, 'page-1', actor);

      expect(versionRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          pageId: 'page-1',
          version: 1,
          title: 'Política de privacidad',
          content: '# Política',
          publishedById: 'user-1',
          publishedByName: 'Ana Pérez',
        }),
      );
      expect(page.publishedVersionId).toBe('version-new');
      expect(page.publishedVersion?.version).toBe(1);
      expect(revalidation.notify).toHaveBeenCalledWith(['cms']);
    });

    it('numbers each new publication after the current one', async () => {
      pageRepo.findOne.mockResolvedValue(
        publishedPage({
          content: '# Política revisada',
          publishedVersion: makeVersion({ version: 3 }),
        }),
      );

      await service.publish(CmsPageKind.PAGE, 'page-1', actor);

      expect(versionRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ version: 4, content: '# Política revisada' }),
      );
    });

    it('refuses to publish an empty text', async () => {
      pageRepo.findOne.mockResolvedValue(makePage({ content: '  \n ' }));

      await expect(
        service.publish(CmsPageKind.PAGE, 'page-1', actor),
      ).rejects.toThrow('No puedes publicar un texto vacío');
      expect(versionRepo.save).not.toHaveBeenCalled();
      expect(revalidation.notify).not.toHaveBeenCalled();
    });

    it('refuses to publish when the store already shows the draft', async () => {
      pageRepo.findOne.mockResolvedValue(publishedPage());

      await expect(
        service.publish(CmsPageKind.PAGE, 'page-1', actor),
      ).rejects.toThrow('No hay cambios que publicar');
      expect(versionRepo.save).not.toHaveBeenCalled();
    });

    it('a new title alone is a change worth publishing', async () => {
      pageRepo.findOne.mockResolvedValue(
        publishedPage({ title: 'Aviso de privacidad' }),
      );

      await service.publish(CmsPageKind.PAGE, 'page-1', actor);

      expect(versionRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ version: 2, title: 'Aviso de privacidad' }),
      );
    });

    it('lists the history newest first', async () => {
      pageRepo.findOne.mockResolvedValue(publishedPage());
      versionRepo.find.mockResolvedValue([]);

      await service.listVersions(CmsPageKind.PAGE, 'page-1');

      expect(versionRepo.find).toHaveBeenCalledWith({
        where: { pageId: 'page-1' },
        order: { version: 'DESC' },
      });
    });
  });

  describe('removal', () => {
    it('frees the slug, soft-deletes and keeps the history', async () => {
      pageRepo.findOne.mockResolvedValue(publishedPage());

      await service.remove(CmsPageKind.PAGE, 'page-1');

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

    it('deleting a never-published draft leaves the store alone', async () => {
      pageRepo.findOne.mockResolvedValue(makePage());

      await service.remove(CmsPageKind.PAGE, 'page-1');

      expect(revalidation.notify).not.toHaveBeenCalled();
    });
  });

  describe('storefront reads', () => {
    it('lists active, published info pages only', async () => {
      pageRepo.find.mockResolvedValue([]);

      await service.listPublishedPages();

      expect(pageRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            kind: CmsPageKind.PAGE,
            isActive: true,
            publishedVersionId: Not(IsNull()),
          },
          relations: { publishedVersion: true },
        }),
      );
    });

    it('a page that was never published is a 404 for the store', async () => {
      pageRepo.findOne.mockResolvedValue(null);

      await expect(
        service.getPublishedPage('politica-de-privacidad'),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(pageRepo.findOne).toHaveBeenCalledWith({
        where: {
          slug: 'politica-de-privacidad',
          kind: CmsPageKind.PAGE,
          isActive: true,
          publishedVersionId: Not(IsNull()),
        },
        relations: { publishedVersion: true },
      });
    });

    it('shows the notices that are published and within their dates', async () => {
      const now = new Date('2026-10-08T12:00:00.000Z');
      pageRepo.find.mockResolvedValue([]);

      await service.listVisibleHomeNotices(now);

      expect(pageRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            kind: CmsPageKind.HOME_NOTICE,
            isActive: true,
            publishedVersionId: Not(IsNull()),
            startsAt: Or(IsNull(), LessThanOrEqual(now)),
            endsAt: Or(IsNull(), MoreThan(now)),
          },
          relations: { publishedVersion: true },
        }),
      );
    });
  });
});
