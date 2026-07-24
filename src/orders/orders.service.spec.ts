import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { CartService } from '../cart/cart.service';
import { CartItem } from '../cart/entities/cart-item.entity';
import { Client } from '../clients/entities/client.entity';
import { InventoryService } from '../inventory/inventory.service';
import { Role, User } from '../users/entities/user.entity';
import { OrderItem } from './entities/order-item.entity';
import { Order, OrderStatus, PaymentStatus } from './entities/order.entity';
import { OrdersService } from './orders.service';
import { PAYMENT_PROVIDER } from './payments/payment-provider.interface';

function makeClient(): Client {
  return { id: 'client-1', defaultMunicipalityId: 'mun-1' } as Client;
}

function makeUser(role: Role): User {
  return { id: 'user-1', role } as User;
}

function makeOrder(overrides: Partial<Order> = {}): Order {
  return {
    id: 'order-1',
    orderNumber: 'ORD-20260001',
    seq: 1,
    clientId: 'client-1',
    status: OrderStatus.PENDING,
    paymentStatus: PaymentStatus.PENDING,
    paymentRef: null,
    subtotal: '15.00',
    deliveryFee: '0.00',
    total: '15.00',
    deliveryMunicipalityId: null,
    deliveryAddress: null,
    customerNotes: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    ...overrides,
  };
}

const cartLine = {
  productId: 'prod-1',
  name: 'Cola 1L',
  slug: 'cola-1l',
  imageUrl: null,
  format: null,
  measureUnit: 'unidad',
  quantity: 2,
  unitPrice: 7.5,
  lineTotal: 15,
  available: 5,
  isAvailable: true,
};

describe('OrdersService', () => {
  let service: OrdersService;
  let orderRepo: {
    findOne: jest.Mock;
    findAndCount: jest.Mock;
    save: jest.Mock;
    create: jest.Mock;
    createQueryBuilder: jest.Mock;
  };
  let cartService: { getCart: jest.Mock };
  let inventoryService: {
    reserve: jest.Mock;
    confirmReservations: jest.Mock;
    releaseReservations: jest.Mock;
  };
  let paymentProvider: { initiatePayment: jest.Mock };
  let orderItemRepo: { save: jest.Mock; create: jest.Mock };
  let cartItemRepo: { delete: jest.Mock };

  beforeEach(async () => {
    orderRepo = {
      findOne: jest.fn(),
      findAndCount: jest.fn().mockResolvedValue([[], 0]),
      save: jest
        .fn()
        .mockImplementation((o: Partial<Order>) =>
          Promise.resolve({ id: 'order-1', seq: 1, ...o }),
        ),
      create: jest.fn().mockImplementation((o: unknown) => o),
      createQueryBuilder: jest.fn(),
    };
    orderItemRepo = {
      save: jest.fn().mockImplementation((o: unknown) => Promise.resolve(o)),
      create: jest.fn().mockImplementation((o: unknown) => o),
    };
    cartItemRepo = { delete: jest.fn() };
    cartService = { getCart: jest.fn() };
    inventoryService = {
      reserve: jest.fn(),
      confirmReservations: jest.fn(),
      releaseReservations: jest.fn(),
    };
    paymentProvider = {
      initiatePayment: jest
        .fn()
        .mockResolvedValue({ status: PaymentStatus.PENDING }),
    };

    const manager = {
      getRepository: (entity: unknown) => {
        if (entity === Order) return orderRepo;
        if (entity === OrderItem) return orderItemRepo;
        if (entity === CartItem) return cartItemRepo;
        return null;
      },
    };
    const dataSource = {
      transaction: jest.fn((cb: (m: unknown) => unknown) => cb(manager)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrdersService,
        { provide: getRepositoryToken(Order), useValue: orderRepo },
        { provide: CartService, useValue: cartService },
        { provide: InventoryService, useValue: inventoryService },
        { provide: PAYMENT_PROVIDER, useValue: paymentProvider },
        { provide: DataSource, useValue: dataSource },
      ],
    }).compile();

    service = module.get(OrdersService);
  });

  describe('checkout', () => {
    beforeEach(() => {
      cartService.getCart.mockResolvedValue({
        items: [cartLine],
        totalItems: 2,
        subtotal: 15,
      });
      // findOneForClient at the end of checkout.
      orderRepo.findOne.mockResolvedValue(makeOrder({ items: [] }));
    });

    it('creates a pending order, reserves stock and clears the cart', async () => {
      const result = await service.checkout(makeClient(), {});

      expect(inventoryService.reserve).toHaveBeenCalledWith(
        expect.anything(),
        'order-1',
        'prod-1',
        2,
      );
      expect(orderItemRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          productNameSnapshot: 'Cola 1L',
          unitPrice: '7.50',
          quantity: 2,
          lineTotal: '15.00',
        }),
      );
      expect(cartItemRepo.delete).toHaveBeenCalledWith({
        clientId: 'client-1',
      });
      expect(paymentProvider.initiatePayment).toHaveBeenCalled();
      expect(result.status).toBe(OrderStatus.PENDING);
      expect(result.paymentStatus).toBe(PaymentStatus.PENDING);
    });

    it('assigns a year-prefixed order number from the sequence', async () => {
      await service.checkout(makeClient(), {});

      const year = new Date().getFullYear();
      expect(orderRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ orderNumber: `ORD-${year}0001` }),
      );
    });

    it('rejects an empty cart', async () => {
      cartService.getCart.mockResolvedValue({
        items: [],
        totalItems: 0,
        subtotal: 0,
      });

      await expect(service.checkout(makeClient(), {})).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('409s when a cart line is no longer available', async () => {
      cartService.getCart.mockResolvedValue({
        items: [{ ...cartLine, isAvailable: false, available: 1 }],
        totalItems: 2,
        subtotal: 15,
      });

      await expect(service.checkout(makeClient(), {})).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(inventoryService.reserve).not.toHaveBeenCalled();
    });
  });

  describe('updateStatus', () => {
    beforeEach(() => {
      // findOneAdmin refetch after the update.
      orderRepo.findOne
        .mockResolvedValueOnce(makeOrder())
        .mockResolvedValue(makeOrder({ items: [] }));
    });

    it('confirming commits the reservations', async () => {
      await service.updateStatus(
        makeUser(Role.ADMIN),
        'order-1',
        OrderStatus.CONFIRMED,
      );

      expect(inventoryService.confirmReservations).toHaveBeenCalledWith(
        expect.anything(),
        'order-1',
      );
    });

    it('cancelling releases the reservations', async () => {
      await service.updateStatus(
        makeUser(Role.ADMIN),
        'order-1',
        OrderStatus.CANCELLED,
      );

      expect(inventoryService.releaseReservations).toHaveBeenCalledWith(
        expect.anything(),
        'order-1',
      );
    });

    it('rejects illegal transitions', async () => {
      orderRepo.findOne.mockReset();
      orderRepo.findOne.mockResolvedValue(makeOrder()); // pending

      await expect(
        service.updateStatus(
          makeUser(Role.ADMIN),
          'order-1',
          OrderStatus.DELIVERED, // pending -> delivered skips the chain
        ),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('forbids GROCER from confirming or cancelling', async () => {
      await expect(
        service.updateStatus(
          makeUser(Role.GROCER),
          'order-1',
          OrderStatus.CONFIRMED,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);

      orderRepo.findOne.mockReset();
      orderRepo.findOne.mockResolvedValue(
        makeOrder({ status: OrderStatus.SHIPPED }),
      );
      await expect(
        service.updateStatus(
          makeUser(Role.GROCER),
          'order-1',
          OrderStatus.CANCELLED,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('lets GROCER advance fulfillment', async () => {
      orderRepo.findOne.mockReset();
      orderRepo.findOne
        .mockResolvedValueOnce(makeOrder({ status: OrderStatus.CONFIRMED }))
        .mockResolvedValue(makeOrder({ items: [] }));

      await service.updateStatus(
        makeUser(Role.GROCER),
        'order-1',
        OrderStatus.PROCESSING,
      );

      expect(orderRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ status: OrderStatus.PROCESSING }),
      );
    });
  });

  describe('cancelByClient', () => {
    it('cancels a pending order and releases the hold', async () => {
      orderRepo.findOne
        .mockResolvedValueOnce(makeOrder())
        .mockResolvedValue(makeOrder({ items: [] }));

      await service.cancelByClient('client-1', 'order-1');

      expect(inventoryService.releaseReservations).toHaveBeenCalledWith(
        expect.anything(),
        'order-1',
      );
    });

    it('409s once the order is no longer pending', async () => {
      orderRepo.findOne.mockResolvedValue(
        makeOrder({ status: OrderStatus.CONFIRMED }),
      );

      await expect(
        service.cancelByClient('client-1', 'order-1'),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(inventoryService.releaseReservations).not.toHaveBeenCalled();
    });
  });
});
