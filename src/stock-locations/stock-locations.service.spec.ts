import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { GeographyService } from '../geography/geography.service';
import { PermissionsService } from '../permissions/permissions.service';
import { RevalidationService } from '../revalidation/revalidation.service';
import { Role, User } from '../users/entities/user.entity';
import { StockLocation } from './entities/stock-location.entity';
import {
  CoverageType,
  StockLocationCoverage,
} from './entities/stock-location-coverage.entity';
import { StockLocationGrocer } from './entities/stock-location-grocer.entity';
import { StockLocationPickupAddress } from './entities/stock-location-pickup-address.entity';
import { StockLocationsService } from './stock-locations.service';

function makeUser(overrides: Partial<User> = {}): User {
  return { id: 'user-1', role: Role.ADMIN, ...overrides } as User;
}

function makeLocation(overrides: Partial<StockLocation> = {}): StockLocation {
  return {
    id: 'loc-1',
    name: 'Almacén 1',
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    ...overrides,
  };
}

type MockRepo = {
  find: jest.Mock;
  findOne: jest.Mock;
  create: jest.Mock;
  save: jest.Mock;
  delete: jest.Mock;
  softDelete: jest.Mock;
};

describe('StockLocationsService', () => {
  let service: StockLocationsService;
  let locationRepo: MockRepo;
  let coverageRepo: MockRepo;
  let grocerRepo: MockRepo;
  let pickupRepo: MockRepo;
  let userRepo: MockRepo;
  let geography: {
    getProvinceOrThrow: jest.Mock;
    getMunicipalityOrThrow: jest.Mock;
  };
  let permissions: {
    hasPermission: jest.Mock;
    getUserIdsWithModuleGrant: jest.Mock;
  };

  beforeEach(async () => {
    const repoMock = (): MockRepo => ({
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn(),
      create: jest.fn().mockImplementation((d: unknown) => d),
      save: jest.fn().mockImplementation((d: unknown) => Promise.resolve(d)),
      delete: jest.fn().mockResolvedValue({ affected: 0 }),
      softDelete: jest.fn().mockResolvedValue({ affected: 1 }),
    });
    locationRepo = repoMock();
    coverageRepo = repoMock();
    grocerRepo = repoMock();
    pickupRepo = repoMock();
    userRepo = repoMock();
    geography = {
      getProvinceOrThrow: jest.fn().mockResolvedValue({ id: 'prov-1' }),
      getMunicipalityOrThrow: jest.fn(),
    };
    permissions = {
      hasPermission: jest.fn().mockResolvedValue(false), // no view-all by default
      getUserIdsWithModuleGrant: jest.fn().mockResolvedValue([]),
    };

    // Transaction manager resolves the same mock repos by entity.
    const dataSource = {
      transaction: jest.fn(
        (
          cb: (m: {
            getRepository: (e: unknown) => MockRepo | null;
          }) => Promise<unknown>,
        ) =>
          cb({
            getRepository: (entity: unknown): MockRepo | null => {
              if (entity === StockLocation) return locationRepo;
              if (entity === StockLocationCoverage) return coverageRepo;
              if (entity === StockLocationGrocer) return grocerRepo;
              if (entity === StockLocationPickupAddress) return pickupRepo;
              return null;
            },
          }),
      ),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StockLocationsService,
        { provide: getRepositoryToken(StockLocation), useValue: locationRepo },
        {
          provide: getRepositoryToken(StockLocationCoverage),
          useValue: coverageRepo,
        },
        {
          provide: getRepositoryToken(StockLocationGrocer),
          useValue: grocerRepo,
        },
        {
          provide: getRepositoryToken(StockLocationPickupAddress),
          useValue: pickupRepo,
        },
        { provide: getRepositoryToken(User), useValue: userRepo },
        { provide: GeographyService, useValue: geography },
        { provide: PermissionsService, useValue: permissions },
        { provide: DataSource, useValue: dataSource },
        { provide: RevalidationService, useValue: { notify: jest.fn() } },
      ],
    }).compile();

    service = module.get(StockLocationsService);
  });

  describe('create', () => {
    it('creates a location with province coverage', async () => {
      locationRepo.save.mockResolvedValue(makeLocation());
      coverageRepo.find.mockResolvedValue([
        {
          coverageType: CoverageType.PROVINCE,
          provinceId: 'prov-1',
          municipalityId: null,
        },
      ]);

      const result = await service.create(makeUser(), {
        name: 'Almacén 1',
        coverage: [
          { coverageType: CoverageType.PROVINCE, provinceId: 'prov-1' },
        ],
      });

      expect(result.name).toBe('Almacén 1');
      expect(result.coverage).toHaveLength(1);
      expect(coverageRepo.save).toHaveBeenCalled();
    });

    it('rejects municipality coverage that belongs to another province', async () => {
      geography.getMunicipalityOrThrow.mockResolvedValue({
        id: 'mun-1',
        provinceId: 'prov-2',
      });

      await expect(
        service.create(makeUser(), {
          name: 'Almacén 1',
          coverage: [
            {
              coverageType: CoverageType.MUNICIPALITY,
              provinceId: 'prov-1',
              municipalityId: 'mun-1',
            },
          ],
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects assigning an admin (they bypass scoping)', async () => {
      userRepo.find.mockResolvedValue([{ id: 'u-1', role: Role.ADMIN }]);

      await expect(
        service.create(makeUser(), {
          name: 'Almacén 1',
          coverage: [
            { coverageType: CoverageType.PROVINCE, provinceId: 'prov-1' },
          ],
          grocerIds: ['u-1'],
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects assigning a user without any stock-locations grant', async () => {
      userRepo.find.mockResolvedValue([{ id: 'u-1', role: Role.KARDIST }]);
      permissions.getUserIdsWithModuleGrant.mockResolvedValue(['someone-else']);

      await expect(
        service.create(makeUser(), {
          name: 'Almacén 1',
          coverage: [
            { coverageType: CoverageType.PROVINCE, provinceId: 'prov-1' },
          ],
          grocerIds: ['u-1'],
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('accepts any non-admin with a stock-locations grant (not only GROCER)', async () => {
      userRepo.find.mockResolvedValue([{ id: 'u-1', role: Role.KARDIST }]);
      permissions.getUserIdsWithModuleGrant.mockResolvedValue(['u-1']);
      locationRepo.save.mockResolvedValue(makeLocation());

      await service.create(makeUser(), {
        name: 'Almacén 1',
        coverage: [],
        grocerIds: ['u-1'],
      });

      expect(grocerRepo.save).toHaveBeenCalledWith([
        { locationId: 'loc-1', grocerId: 'u-1' },
      ]);
    });
  });

  describe('listAssignableUsers', () => {
    it('returns active non-admin users holding a stock-locations grant', async () => {
      permissions.getUserIdsWithModuleGrant.mockResolvedValue(['u-1', 'u-2']);
      userRepo.find.mockResolvedValue([
        {
          id: 'u-1',
          firstName: 'Ana',
          lastName: null,
          email: 'a@x.com',
          role: Role.KARDIST,
        },
        // Defensive: an admin id in the grant set is still filtered out.
        {
          id: 'u-2',
          firstName: 'Root',
          lastName: null,
          email: 'r@x.com',
          role: Role.ADMIN,
        },
      ]);

      const result = await service.listAssignableUsers();
      expect(result).toEqual([
        {
          id: 'u-1',
          firstName: 'Ana',
          lastName: null,
          email: 'a@x.com',
          role: Role.KARDIST,
        },
      ]);
    });

    it('short-circuits when nobody holds the module', async () => {
      const result = await service.listAssignableUsers();
      expect(result).toEqual([]);
      expect(userRepo.find).not.toHaveBeenCalled();
    });
  });

  describe('findAll (grocer scoping)', () => {
    it('returns only assigned locations for a grocer', async () => {
      const grocer = makeUser({ id: 'g-1', role: Role.GROCER });
      grocerRepo.find.mockResolvedValueOnce([{ locationId: 'loc-1' }]); // assignedLocationIds
      locationRepo.find.mockResolvedValue([makeLocation()]);
      coverageRepo.find.mockResolvedValue([]);
      grocerRepo.find.mockResolvedValueOnce([]); // bulk grocers

      const result = await service.findAll(grocer);
      expect(result).toHaveLength(1);
      expect(locationRepo.find).toHaveBeenCalled();
    });

    it('returns empty when the grocer has no assignments', async () => {
      const grocer = makeUser({ id: 'g-1', role: Role.GROCER });
      grocerRepo.find.mockResolvedValue([]);

      const result = await service.findAll(grocer);
      expect(result).toEqual([]);
      expect(locationRepo.find).not.toHaveBeenCalled();
    });

    it('returns every location for a non-admin with view-all', async () => {
      const viewer = makeUser({ id: 'v-1', role: Role.KARDIST });
      permissions.hasPermission.mockResolvedValue(true);
      locationRepo.find.mockResolvedValue([makeLocation()]);

      const result = await service.findAll(viewer);
      expect(result).toHaveLength(1);
      // No assignment lookup — the id filter was never applied.
      expect(permissions.hasPermission).toHaveBeenCalledWith(
        'v-1',
        Role.KARDIST,
        'stock-locations',
        'view-all',
      );
    });
  });

  describe('findOne', () => {
    it('forbids an unassigned grocer', async () => {
      locationRepo.findOne.mockResolvedValue(makeLocation());
      grocerRepo.findOne.mockResolvedValue(null); // not assigned

      await expect(
        service.findOne(makeUser({ id: 'g-1', role: Role.GROCER }), 'loc-1'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('allows an unassigned non-admin with view-all', async () => {
      locationRepo.findOne.mockResolvedValue(makeLocation());
      permissions.hasPermission.mockResolvedValue(true);
      grocerRepo.findOne.mockResolvedValue(null); // not assigned

      await expect(
        service.findOne(makeUser({ id: 'v-1', role: Role.KARDIST }), 'loc-1'),
      ).resolves.toBeTruthy();
    });
  });

  describe('assertCanManage', () => {
    it('view-all does NOT grant write access', async () => {
      locationRepo.findOne.mockResolvedValue(makeLocation());
      permissions.hasPermission.mockResolvedValue(true); // view-all held
      grocerRepo.findOne.mockResolvedValue(null); // not assigned

      await expect(
        service.assertCanManage(
          makeUser({ id: 'v-1', role: Role.KARDIST }),
          'loc-1',
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('update', () => {
    it('ignores grocerIds when the actor is a grocer', async () => {
      const grocer = makeUser({ id: 'g-1', role: Role.GROCER });
      locationRepo.findOne.mockResolvedValue(makeLocation());
      grocerRepo.findOne.mockResolvedValue({ id: 'a-1' }); // assigned

      await service.update(grocer, 'loc-1', {
        name: 'Renamed',
        grocerIds: ['x'],
      });

      // grocer assignment table must NOT be rewritten by a grocer
      expect(grocerRepo.delete).not.toHaveBeenCalled();
      expect(userRepo.find).not.toHaveBeenCalled();
    });
  });
});
