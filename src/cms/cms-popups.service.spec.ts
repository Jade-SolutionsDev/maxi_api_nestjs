import { BadRequestException, ConflictException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { RevalidationService } from '../revalidation/revalidation.service';
import { CmsPopupsService } from './cms-popups.service';
import { CmsPopup } from './entities/cms-popup.entity';

const fecha = (iso: string) => new Date(iso);

const aviso = (cambios: Partial<CmsPopup> = {}): CmsPopup => ({
  id: 'pop-1',
  title: 'Envío gratis desde $50',
  body: 'Hasta el 31 de octubre.',
  buttonLabel: null,
  buttonHref: null,
  desktop: null,
  tablet: null,
  mobile: null,
  startsAt: null,
  endsAt: null,
  repeatAfterHours: null,
  isActive: true,
  publishedAt: null,
  createdBy: null,
  updatedBy: null,
  createdAt: fecha('2026-10-01T00:00:00Z'),
  updatedAt: fecha('2026-10-01T00:00:00Z'),
  deletedAt: null,
  ...cambios,
});

describe('CmsPopupsService', () => {
  let service: CmsPopupsService;
  let repo: {
    find: jest.Mock;
    findOne: jest.Mock;
    save: jest.Mock;
    create: jest.Mock;
    softDelete: jest.Mock;
  };
  let revalidation: { notify: jest.Mock };

  beforeEach(async () => {
    repo = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn(),
      save: jest.fn().mockImplementation((p: unknown) => Promise.resolve(p)),
      create: jest.fn().mockImplementation((p: unknown) => p),
      softDelete: jest.fn(),
    };
    revalidation = { notify: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CmsPopupsService,
        { provide: getRepositoryToken(CmsPopup), useValue: repo },
        { provide: RevalidationService, useValue: revalidation },
      ],
    }).compile();

    service = module.get(CmsPopupsService);
  });

  describe('crear', () => {
    it('nace como borrador aunque le pongan fechas', async () => {
      const creado = await service.create(
        { title: 'Aviso', body: 'Texto', startsAt: '2026-11-01T00:00:00Z' },
        'user-1',
      );

      expect(creado.publishedAt).toBeNull();
      expect(creado.state).toBe('borrador');
      expect(creado.createdBy).toBe('user-1');
    });

    it('la imagen va en las tres medidas o en ninguna', async () => {
      const media = { src: 'x.webp', width: 10, height: 10 };

      await expect(
        service.create(
          { title: 'Aviso', body: 'Texto', desktop: media },
          'user-1',
        ),
      ).rejects.toBeInstanceOf(BadRequestException);

      await expect(
        service.create(
          {
            title: 'Aviso',
            body: 'Texto',
            desktop: media,
            tablet: media,
            mobile: media,
          },
          'user-1',
        ),
      ).resolves.toBeDefined();
    });

    it('un enlace sin texto de botón no se puede pulsar', async () => {
      await expect(
        service.create(
          { title: 'Aviso', body: 'Texto', buttonHref: '/catalog' },
          'user-1',
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('publicar', () => {
    it('publica y avisa a la tienda', async () => {
      repo.findOne.mockResolvedValue(aviso());

      const publicado = await service.publish('pop-1', 'user-2');

      expect(publicado.publishedAt).not.toBeNull();
      expect(publicado.state).toBe('vigente');
      expect(revalidation.notify).toHaveBeenCalledWith(['cms']);
    });

    it('no deja dos avisos vigentes a la vez', async () => {
      // Es el fallo que el cliente ve y nadie prueba: dos ventanas peleándose.
      repo.findOne.mockResolvedValue(aviso({ id: 'pop-2', title: 'El nuevo' }));
      repo.find.mockResolvedValue([
        aviso({
          id: 'pop-1',
          title: 'El de siempre',
          publishedAt: fecha('2026-10-10T00:00:00Z'),
        }),
      ]);

      await expect(service.publish('pop-2', 'user-2')).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('dos avisos con fechas que no se tocan conviven', async () => {
      repo.findOne.mockResolvedValue(
        aviso({
          id: 'pop-2',
          startsAt: fecha('2026-11-01T00:00:00Z'),
          endsAt: fecha('2026-11-30T00:00:00Z'),
        }),
      );
      repo.find.mockResolvedValue([
        aviso({
          id: 'pop-1',
          publishedAt: fecha('2026-10-01T00:00:00Z'),
          startsAt: fecha('2026-10-01T00:00:00Z'),
          endsAt: fecha('2026-10-31T00:00:00Z'),
        }),
      ]);

      await expect(service.publish('pop-2', 'user-2')).resolves.toBeDefined();
    });

    it('retirarlo lo devuelve a borrador sin borrarlo', async () => {
      repo.findOne.mockResolvedValue(
        aviso({ publishedAt: fecha('2026-10-10T00:00:00Z') }),
      );

      const retirado = await service.unpublish('pop-1', 'user-2');

      expect(retirado.publishedAt).toBeNull();
      expect(retirado.state).toBe('borrador');
      expect(revalidation.notify).toHaveBeenCalledWith(['cms']);
    });
  });

  describe('el que ve la tienda', () => {
    const ahora = fecha('2026-10-18T12:00:00Z');

    it('devuelve el vigente', async () => {
      repo.find.mockResolvedValue([
        aviso({ publishedAt: fecha('2026-10-01T00:00:00Z') }),
      ]);

      const vigente = await service.vigente(ahora);

      expect(vigente?.title).toBe('Envío gratis desde $50');
      expect(vigente?.version).toBeDefined();
    });

    it('un borrador no sale, aunque esté activo y en fecha', async () => {
      repo.find.mockResolvedValue([aviso({ publishedAt: null })]);

      await expect(service.vigente(ahora)).resolves.toBeNull();
    });

    it('uno caducado no sale: se retira solo', async () => {
      repo.find.mockResolvedValue([
        aviso({
          publishedAt: fecha('2026-10-01T00:00:00Z'),
          endsAt: fecha('2026-10-17T00:00:00Z'),
        }),
      ]);

      await expect(service.vigente(ahora)).resolves.toBeNull();
    });

    it('uno programado todavía no sale', async () => {
      repo.find.mockResolvedValue([
        aviso({
          publishedAt: fecha('2026-10-01T00:00:00Z'),
          startsAt: fecha('2026-11-01T00:00:00Z'),
        }),
      ]);

      await expect(service.vigente(ahora)).resolves.toBeNull();
    });

    it('sin ninguno, la tienda no cambia en nada', async () => {
      repo.find.mockResolvedValue([]);

      await expect(service.vigente(ahora)).resolves.toBeNull();
    });
  });
});
