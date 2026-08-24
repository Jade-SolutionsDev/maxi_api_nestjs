import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { GeographyService } from '../geography/geography.service';
import {
  ClientAddressesService,
  MAX_ADDRESSES_PER_CLIENT,
} from './client-addresses.service';
import { ClientAddress } from './entities/client-address.entity';

function makeAddress(overrides: Partial<ClientAddress> = {}): ClientAddress {
  return {
    id: 'addr-1',
    clientId: 'client-1',
    label: 'Casa',
    street: 'Calle 23 #456',
    betweenStreets: 'entre 8 y 10',
    reference: 'Edificio azul',
    municipalityId: 'mun-1',
    contactPhone: '55512345',
    isDefault: true,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    deletedAt: null,
    ...overrides,
  };
}

describe('ClientAddressesService', () => {
  let service: ClientAddressesService;
  let repository: jest.Mocked<Repository<ClientAddress>>;
  let geography: {
    getMunicipalityOrThrow: jest.Mock;
    listMunicipalities: jest.Mock;
    listProvinces: jest.Mock;
  };

  beforeEach(async () => {
    geography = {
      getMunicipalityOrThrow: jest.fn().mockResolvedValue({
        id: 'mun-1',
        provinceId: 'prov-1',
        name: 'Plaza',
        code: 'CU-03-01',
      }),
      listMunicipalities: jest.fn().mockResolvedValue([
        { id: 'mun-1', provinceId: 'prov-1', name: 'Plaza', code: 'CU-03-01' },
      ]),
      listProvinces: jest
        .fn()
        .mockResolvedValue([
          { id: 'prov-1', name: 'La Habana', code: 'CU-03' },
        ]),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClientAddressesService,
        {
          provide: getRepositoryToken(ClientAddress),
          useValue: {
            find: jest.fn().mockResolvedValue([]),
            findOne: jest.fn(),
            count: jest.fn().mockResolvedValue(0),
            create: jest.fn((v: Partial<ClientAddress>) => v),
            save: jest.fn((v: Partial<ClientAddress>) => v),
            update: jest.fn(),
            softDelete: jest.fn(),
          },
        },
        { provide: GeographyService, useValue: geography },
      ],
    }).compile();

    service = module.get(ClientAddressesService);
    repository = module.get(getRepositoryToken(ClientAddress));
  });

  describe('create', () => {
    it('makes the first address the default one', async () => {
      repository.count.mockResolvedValue(0);

      const created = await service.create('client-1', {
        street: 'Calle 23 #456',
        municipalityId: 'mun-1',
      });

      expect(created.isDefault).toBe(true);
    });

    it('does not make a later address default on its own', async () => {
      repository.count.mockResolvedValue(1);

      const created = await service.create('client-1', {
        street: 'Calle 25 #10',
        municipalityId: 'mun-1',
      });

      expect(created.isDefault).toBe(false);
    });

    it('rejects a municipality that is not in the catalog', async () => {
      geography.getMunicipalityOrThrow.mockRejectedValue(
        new NotFoundException(),
      );

      await expect(
        service.create('client-1', {
          street: 'Calle 23',
          municipalityId: 'nope',
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('refuses to go past the per-client cap', async () => {
      repository.count.mockResolvedValue(MAX_ADDRESSES_PER_CLIENT);

      await expect(
        service.create('client-1', {
          street: 'Calle 23',
          municipalityId: 'mun-1',
        }),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('findAllForClient', () => {
    it('asks for the client rows, default first and newest next', async () => {
      const rows = [makeAddress()];
      repository.find.mockResolvedValue(rows);

      await expect(service.findAllForClient('client-1')).resolves.toBe(rows);
      expect(repository.find).toHaveBeenCalledWith({
        where: { clientId: 'client-1' },
        order: { isDefault: 'DESC', createdAt: 'DESC' },
      });
    });
  });

  describe('findOneForClient', () => {
    it('reports another customer\u2019s address as missing', async () => {
      repository.findOne.mockResolvedValue(null);

      await expect(
        service.findOneForClient('client-1', 'addr-9'),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(repository.findOne).toHaveBeenCalledWith({
        where: { id: 'addr-9', clientId: 'client-1' },
      });
    });
  });

  describe('update', () => {
    it('validates a municipality only when it changes', async () => {
      repository.findOne.mockResolvedValue(makeAddress());

      await service.update('client-1', 'addr-1', { street: 'Calle 25 #10' });

      expect(geography.getMunicipalityOrThrow).not.toHaveBeenCalled();
      expect(repository.save).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'addr-1', street: 'Calle 25 #10' }),
      );
    });

    it('leaves the default flag alone', async () => {
      repository.findOne.mockResolvedValue(makeAddress({ isDefault: false }));

      const updated = await service.update('client-1', 'addr-1', {
        isDefault: true,
      });

      expect(updated.isDefault).toBe(false);
    });

    it('clears an optional field when it is sent empty', async () => {
      repository.findOne.mockResolvedValue(
        makeAddress({ reference: 'Edificio azul' }),
      );

      const updated = await service.update('client-1', 'addr-1', {
        reference: '',
      });

      expect(updated.reference).toBeNull();
    });
  });

  describe('remove', () => {
    it('soft-deletes and promotes the newest survivor when the default goes', async () => {
      repository.findOne
        .mockResolvedValueOnce(makeAddress({ id: 'addr-1', isDefault: true }))
        .mockResolvedValueOnce(makeAddress({ id: 'addr-2', isDefault: false }));

      await service.remove('client-1', 'addr-1');

      expect(repository.softDelete).toHaveBeenCalledWith('addr-1');
      expect(repository.update).toHaveBeenCalledWith(
        { id: 'addr-2' },
        { isDefault: true },
      );
    });

    it('promotes nobody when the deleted one was not the default', async () => {
      repository.findOne.mockResolvedValueOnce(
        makeAddress({ isDefault: false }),
      );

      await service.remove('client-1', 'addr-1');

      expect(repository.update).not.toHaveBeenCalled();
    });

    it('promotes nobody when it was the last address', async () => {
      repository.findOne
        .mockResolvedValueOnce(makeAddress({ isDefault: true }))
        .mockResolvedValueOnce(null);

      await service.remove('client-1', 'addr-1');

      expect(repository.update).not.toHaveBeenCalled();
    });
  });
});
