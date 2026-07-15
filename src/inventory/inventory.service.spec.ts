import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { Product } from '../products/entities/product.entity';
import { StockLocationsService } from '../stock-locations/stock-locations.service';
import { Role, User } from '../users/entities/user.entity';
import { Inventory } from './entities/inventory.entity';
import {
  InventoryOperation,
  OperationType,
} from './entities/inventory-operation.entity';
import { InventoryOperationItem } from './entities/inventory-operation-item.entity';
import { InventoryService } from './inventory.service';

function makeUser(overrides: Partial<User> = {}): User {
  return { id: 'user-1', role: Role.ADMIN, ...overrides } as User;
}

type MockRepo = {
  find: jest.Mock;
  findOne: jest.Mock;
  create: jest.Mock;
  save: jest.Mock;
  count: jest.Mock;
};

describe('InventoryService', () => {
  let service: InventoryService;
  let inventoryRepo: MockRepo;
  let operationRepo: MockRepo;
  let itemRepo: MockRepo;
  let productRepo: MockRepo;
  let stockLocations: {
    assertCanManage: jest.Mock;
    getActiveLocationOrThrow: jest.Mock;
  };

  beforeEach(async () => {
    const repoMock = (): MockRepo => ({
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockImplementation((d: unknown) => d),
      save: jest
        .fn()
        .mockImplementation((d: unknown) =>
          Promise.resolve(Array.isArray(d) ? d : { id: 'op-1', ...d }),
        ),
      count: jest.fn().mockResolvedValue(1),
    });
    inventoryRepo = repoMock();
    operationRepo = repoMock();
    itemRepo = repoMock();
    productRepo = repoMock();
    stockLocations = {
      assertCanManage: jest.fn().mockResolvedValue({ id: 'loc-1' }),
      getActiveLocationOrThrow: jest.fn().mockResolvedValue({ id: 'loc-2' }),
    };

    const dataSource = {
      transaction: jest.fn(
        (
          cb: (m: {
            getRepository: (e: unknown) => MockRepo | null;
          }) => unknown,
        ) =>
          cb({
            getRepository: (entity: unknown): MockRepo | null => {
              if (entity === Inventory) return inventoryRepo;
              if (entity === InventoryOperation) return operationRepo;
              if (entity === InventoryOperationItem) return itemRepo;
              return null;
            },
          }),
      ),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InventoryService,
        { provide: getRepositoryToken(Inventory), useValue: inventoryRepo },
        {
          provide: getRepositoryToken(InventoryOperation),
          useValue: operationRepo,
        },
        {
          provide: getRepositoryToken(InventoryOperationItem),
          useValue: itemRepo,
        },
        { provide: getRepositoryToken(Product), useValue: productRepo },
        { provide: StockLocationsService, useValue: stockLocations },
        { provide: DataSource, useValue: dataSource },
      ],
    }).compile();

    service = module.get(InventoryService);
  });

  it('IN creates stock and checks the actor can manage the storage', async () => {
    inventoryRepo.findOne.mockResolvedValue(null); // new product at this storage

    const result = await service.createOperation(makeUser(), {
      locationId: 'loc-1',
      type: OperationType.IN,
      items: [{ productId: 'p-1', quantity: 10 }],
    });

    expect(stockLocations.assertCanManage).toHaveBeenCalledWith(
      expect.anything(),
      'loc-1',
    );
    expect(inventoryRepo.save).toHaveBeenCalled();
    expect(result.type).toBe('IN');
    expect(result.items).toEqual([{ productId: 'p-1', quantity: 10 }]);
  });

  it('merges duplicate product lines into one', async () => {
    inventoryRepo.findOne.mockResolvedValue(null);

    const result = await service.createOperation(makeUser(), {
      locationId: 'loc-1',
      type: OperationType.IN,
      items: [
        { productId: 'p-1', quantity: 3 },
        { productId: 'p-1', quantity: 4 },
      ],
    });

    expect(result.items).toEqual([{ productId: 'p-1', quantity: 7 }]);
  });

  it('OUT rejects insufficient stock', async () => {
    inventoryRepo.findOne.mockResolvedValue({ id: 'inv-1', quantity: 3 });

    await expect(
      service.createOperation(makeUser(), {
        locationId: 'loc-1',
        type: OperationType.OUT,
        items: [{ productId: 'p-1', quantity: 5 }],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('TRANSFER requires a destination storage', async () => {
    await expect(
      service.createOperation(makeUser(), {
        locationId: 'loc-1',
        type: OperationType.TRANSFER,
        items: [{ productId: 'p-1', quantity: 1 }],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('TRANSFER rejects the same source and destination', async () => {
    await expect(
      service.createOperation(makeUser(), {
        locationId: 'loc-1',
        type: OperationType.TRANSFER,
        targetLocationId: 'loc-1',
        items: [{ productId: 'p-1', quantity: 1 }],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects operations referencing unknown products', async () => {
    productRepo.count.mockResolvedValue(0); // product not found

    await expect(
      service.createOperation(makeUser(), {
        locationId: 'loc-1',
        type: OperationType.IN,
        items: [{ productId: 'ghost', quantity: 1 }],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
