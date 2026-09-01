import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { RevalidationService } from '../revalidation/revalidation.service';
import { Nomenclator } from './entities/nomenclator.entity';
import { NomenclatorsService } from './nomenclators.service';

const makeNomenclator = (
  overrides: Partial<Nomenclator> = {},
): Nomenclator => ({
  id: 'nom-1',
  category: 'contact-motive',
  code: 'pedidos',
  label: 'Pedidos',
  description: null,
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
  update: jest.Mock;
  softDelete: jest.Mock;
};

describe('NomenclatorsService', () => {
  let service: NomenclatorsService;
  let repo: RepoMock;
  let revalidation: { notify: jest.Mock };

  beforeEach(async () => {
    repo = {
      find: jest.fn(),
      findOne: jest.fn(),
      create: jest.fn((input: unknown) => input),
      save: jest.fn((input: unknown) => Promise.resolve(input)),
      update: jest.fn(),
      softDelete: jest.fn(),
    };
    revalidation = { notify: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NomenclatorsService,
        { provide: getRepositoryToken(Nomenclator), useValue: repo },
        { provide: RevalidationService, useValue: revalidation },
      ],
    }).compile();

    service = module.get<NomenclatorsService>(NomenclatorsService);
  });

  it('deriva el code del label y notifica al crear', async () => {
    repo.findOne.mockResolvedValue(null);

    await service.create({
      category: 'contact-motive',
      label: 'Pagos y facturación',
    });

    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'pagos-y-facturacion' }),
    );
    expect(revalidation.notify).toHaveBeenCalledWith(['nomenclators']);
  });

  it('sufija el code cuando otra opción ACTIVA lo ocupa en la categoría', async () => {
    repo.findOne
      .mockResolvedValueOnce(makeNomenclator())
      .mockResolvedValueOnce(null);

    await service.create({ category: 'contact-motive', label: 'Pedidos' });

    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'pedidos-2' }),
    );
  });

  it('recupera el code de una opción soft-eliminada', async () => {
    repo.findOne.mockResolvedValueOnce(
      makeNomenclator({ id: 'old-1', deletedAt: new Date('2026-02-01') }),
    );

    await service.create({ category: 'contact-motive', label: 'Pedidos' });

    expect(repo.update).toHaveBeenCalledWith('old-1', {
      code: expect.stringMatching(/^pedidos-eliminado-\d+$/) as string,
    });
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'pedidos' }),
    );
  });

  it('listActive filtra por categoría y actividad', async () => {
    repo.find.mockResolvedValue([]);

    await service.listActive('contact-motive');

    expect(repo.find).toHaveBeenCalledWith({
      where: { category: 'contact-motive', isActive: true },
      order: { sortOrder: 'ASC', label: 'ASC' },
    });
  });

  it('remove hace soft delete y notifica', async () => {
    repo.findOne.mockResolvedValue(makeNomenclator());

    await service.remove('nom-1');

    expect(repo.softDelete).toHaveBeenCalledWith('nom-1');
    expect(revalidation.notify).toHaveBeenCalledWith(['nomenclators']);
  });

  it('update de un id inexistente lanza NotFound', async () => {
    repo.findOne.mockResolvedValue(null);

    await expect(service.update('nope', {})).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
