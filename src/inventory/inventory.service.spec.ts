import { BadRequestException, ConflictException } from '@nestjs/common';
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
import { ReservationStatus } from './entities/inventory-reservation.entity';
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
  manager: { query: jest.Mock };
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
      manager: { query: jest.fn().mockResolvedValue([]) },
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

  it('OUT cannot take stock held by order reservations', async () => {
    inventoryRepo.findOne.mockResolvedValue({
      id: 'inv-1',
      quantity: 5,
      reservedQuantity: 3,
    });

    await expect(
      service.createOperation(makeUser(), {
        locationId: 'loc-1',
        type: OperationType.OUT,
        items: [{ productId: 'p-1', quantity: 4 }], // only 2 unreserved
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  describe('order reservations', () => {
    let reservationRepo: MockRepo;
    let manager: {
      getRepository: (entity: unknown) => MockRepo;
      query: jest.Mock;
    };

    beforeEach(() => {
      reservationRepo = {
        find: jest.fn().mockResolvedValue([]),
        findOne: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockImplementation((d: unknown) => d),
        save: jest.fn().mockImplementation((d: unknown) => Promise.resolve(d)),
        count: jest.fn(),
        manager: { query: jest.fn().mockResolvedValue([]) },
      };
      manager = {
        getRepository: (entity: unknown): MockRepo =>
          entity === Inventory ? inventoryRepo : reservationRepo,
        // reserve() first fetches enabled-location ids; the mock inventoryRepo
        // ignores the where clause, so any non-empty set keeps the flow intact.
        query: jest.fn().mockResolvedValue([{ id: 'loc-A' }, { id: 'loc-B' }]),
      };
    });

    it('reserves greedily from the storages with most available stock', async () => {
      const locA = {
        locationId: 'loc-A',
        productId: 'p-1',
        quantity: 5,
        reservedQuantity: 2,
      }; // 3 available
      const locB = {
        locationId: 'loc-B',
        productId: 'p-1',
        quantity: 4,
        reservedQuantity: 0,
      }; // 4 available
      inventoryRepo.find.mockResolvedValue([locA, locB]);

      await service.reserve(manager as never, 'order-1', 'p-1', 5);

      // 4 from loc-B (most available), 1 from loc-A.
      expect(locB.reservedQuantity).toBe(4);
      expect(locA.reservedQuantity).toBe(3);
      expect(reservationRepo.save).toHaveBeenCalledTimes(2);
      expect(reservationRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ locationId: 'loc-B', quantity: 4 }),
      );
      expect(reservationRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ locationId: 'loc-A', quantity: 1 }),
      );
    });

    it('409s when total available across storages is insufficient', async () => {
      inventoryRepo.find.mockResolvedValue([
        {
          locationId: 'loc-A',
          productId: 'p-1',
          quantity: 5,
          reservedQuantity: 3,
        },
      ]);

      await expect(
        service.reserve(manager as never, 'order-1', 'p-1', 3),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(inventoryRepo.save).not.toHaveBeenCalled();
      expect(reservationRepo.save).not.toHaveBeenCalled();
    });

    it('does not reserve when no storages are enabled', async () => {
      manager.query.mockResolvedValue([]); // no active locations
      inventoryRepo.find.mockResolvedValue([
        {
          locationId: 'loc-A',
          productId: 'p-1',
          quantity: 99,
          reservedQuantity: 0,
        },
      ]);

      await expect(
        service.reserve(manager as never, 'order-1', 'p-1', 1),
      ).rejects.toBeInstanceOf(ConflictException);
      // The disabled-location stock is never even queried/locked.
      expect(inventoryRepo.find).not.toHaveBeenCalled();
      expect(reservationRepo.save).not.toHaveBeenCalled();
    });

    it('confirm decrements physical and reserved stock together', async () => {
      const row = {
        locationId: 'loc-A',
        productId: 'p-1',
        quantity: 5,
        reservedQuantity: 3,
      };
      const reservation = {
        orderId: 'order-1',
        locationId: 'loc-A',
        productId: 'p-1',
        quantity: 3,
        status: ReservationStatus.RESERVED,
      };
      reservationRepo.find.mockResolvedValueOnce([reservation]);
      inventoryRepo.findOne.mockResolvedValue(row);

      await service.confirmReservations(manager as never, 'order-1');

      expect(row.quantity).toBe(2);
      expect(row.reservedQuantity).toBe(0);
      expect(reservation.status).toBe(ReservationStatus.CONFIRMED);
    });

    it('release frees held stock and restocks confirmed allocations', async () => {
      const row = {
        locationId: 'loc-A',
        productId: 'p-1',
        quantity: 5,
        reservedQuantity: 2,
      };
      const held = {
        orderId: 'order-1',
        locationId: 'loc-A',
        productId: 'p-1',
        quantity: 2,
        status: ReservationStatus.RESERVED,
      };
      const committed = {
        orderId: 'order-1',
        locationId: 'loc-A',
        productId: 'p-1',
        quantity: 3,
        status: ReservationStatus.CONFIRMED,
      };
      // settle pass sees the reserved row; restock pass sees the confirmed one.
      reservationRepo.find
        .mockResolvedValueOnce([held])
        .mockResolvedValueOnce([committed]);
      inventoryRepo.findOne.mockResolvedValue(row);

      await service.releaseReservations(manager as never, 'order-1');

      expect(row.reservedQuantity).toBe(0); // hold freed
      expect(row.quantity).toBe(8); // 5 + 3 restocked
      expect(held.status).toBe(ReservationStatus.CANCELLED);
      expect(committed.status).toBe(ReservationStatus.CANCELLED);
    });
  });

  describe('history', () => {
    it('merges manual operations and order reservations, newest first', async () => {
      inventoryRepo.manager.query
        .mockResolvedValueOnce([
          {
            type: 'IN',
            product_id: 'p-1',
            product_name: 'Arroz',
            quantity: 10,
            location_id: 'loc-A',
            location_name: 'A',
            target_location_id: null,
            target_location_name: null,
            note: 'compra',
            created_by: 'u-1',
            first_name: 'Ana',
            last_name: 'Pérez',
            created_at: new Date('2026-07-20T10:00:00Z'),
          },
        ])
        .mockResolvedValueOnce([
          {
            status: 'confirmed',
            product_id: 'p-1',
            product_name: 'Arroz',
            quantity: 5,
            location_id: 'loc-A',
            location_name: 'A',
            order_id: 'ord-9',
            created_at: new Date('2026-07-21T09:00:00Z'),
            updated_at: new Date('2026-07-22T09:00:00Z'),
          },
        ]);

      const events = await service.history({ productId: 'p-1' });

      // A confirmed reservation yields reserved(created) + confirmed(updated).
      expect(events.map((e) => e.type)).toEqual([
        'confirmed',
        'reserved',
        'IN',
      ]);
      const op = events.find((e) => e.kind === 'operation');
      expect(op?.actorName).toBe('Ana Pérez');
      expect(op?.orderId).toBeNull();
      const confirmed = events.find((e) => e.type === 'confirmed');
      expect(confirmed?.orderId).toBe('ord-9');
      expect(confirmed?.actorName).toBeNull();
    });
  });
});
