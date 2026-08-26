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
import { ClientAddressesService } from '../client-addresses/client-addresses.service';
import { FulfillmentService } from '../fulfillment/fulfillment.service';
import { GeographyService } from '../geography/geography.service';
import { PaymentMethodsService } from '../payments/payment-methods.service';
import { PaymentsService } from '../payments/payments.service';

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
  let paymentsService: {
    createChargeForOrder: jest.Mock;
    latestChargeDto: jest.Mock;
    latestMethodsFor: jest.Mock;
  };
  let paymentMethodsService: { resolve: jest.Mock };
  let fulfillmentService: { resolveChoice: jest.Mock };
  let clientAddressesService: {
    findOneForClient: jest.Mock;
    create: jest.Mock;
  };
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
    paymentsService = {
      createChargeForOrder: jest.fn().mockResolvedValue({ id: 'charge-1' }),
      latestChargeDto: jest.fn().mockResolvedValue(undefined),
      latestMethodsFor: jest.fn().mockResolvedValue(new Map()),
    };
    paymentMethodsService = {
      resolve: jest.fn().mockResolvedValue({ code: 'manual' }),
    };
    fulfillmentService = {
      resolveChoice: jest.fn().mockResolvedValue({
        type: 'delivery',
        fee: '0.00',
        deliveryOptionId: null,
        deliveryOptionLabel: null,
        pickupLocationId: null,
        pickupAddressId: null,
        pickupAddressSnapshot: null,
      }),
    };
    clientAddressesService = {
      findOneForClient: jest.fn(),
      create: jest.fn(),
    };
    geographyService = {
      getMunicipalityOrThrow: jest
        .fn()
        .mockResolvedValue({ id: 'mun-9', name: 'Báguanos', provinceId: 'p1' }),
      getProvinceOrThrow: jest
        .fn()
        .mockResolvedValue({ id: 'p1', name: 'Holguín' }),
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
        { provide: PaymentsService, useValue: paymentsService },
        { provide: PaymentMethodsService, useValue: paymentMethodsService },
        { provide: FulfillmentService, useValue: fulfillmentService },
        { provide: ClientAddressesService, useValue: clientAddressesService },
        { provide: GeographyService, useValue: geographyService },
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
        undefined,
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
      expect(paymentsService.createChargeForOrder).toHaveBeenCalled();
      expect(result.status).toBe(OrderStatus.PENDING);
      expect(result.paymentStatus).toBe(PaymentStatus.PENDING);
    });

    it('holds pickup stock in the storage the customer collects from', async () => {
      fulfillmentService.resolveChoice.mockResolvedValue({
        type: 'pickup',
        fee: '0.00',
        deliveryOptionId: null,
        deliveryOptionLabel: null,
        pickupLocationId: 'loc-1',
        pickupAddressId: 'pick-1',
        pickupAddressSnapshot: { address: 'Calle 1' },
      });

      await service.checkout(makeClient(), {});

      expect(cartService.getCart).toHaveBeenCalledWith('client-1', {
        locationId: 'loc-1',
      });
      expect(inventoryService.reserve).toHaveBeenCalledWith(
        expect.anything(),
        'order-1',
        'prod-1',
        2,
        'loc-1',
      );
      expect(orderRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          fulfillmentType: 'pickup',
          pickupLocationId: 'loc-1',
        }),
      );
    });

    it('charges the delivery fee of the chosen option', async () => {
      fulfillmentService.resolveChoice.mockResolvedValue({
        type: 'delivery',
        fee: '5.00',
        deliveryOptionId: 'opt-1',
        deliveryOptionLabel: 'Mensajería',
        pickupLocationId: null,
        pickupAddressId: null,
        pickupAddressSnapshot: null,
      });

      await service.checkout(makeClient(), {});

      expect(orderRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          subtotal: '15.00',
          deliveryFee: '5.00',
          total: '20.00',
          deliveryOptionLabel: 'Mensajería',
        }),
      );
    });

    it('refuses a fulfillment choice the shop cannot honour', async () => {
      fulfillmentService.resolveChoice.mockRejectedValue(
        new BadRequestException('nothing available'),
      );

      await expect(service.checkout(makeClient(), {})).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(orderRepo.save).not.toHaveBeenCalled();
      expect(inventoryService.reserve).not.toHaveBeenCalled();
    });

    it('snapshots a saved address and ships to its municipality', async () => {
      clientAddressesService.findOneForClient.mockResolvedValue({
        id: 'addr-1',
        clientId: 'client-1',
        label: 'Casa',
        street: 'Calle 23 #456',
        betweenStreets: null,
        reference: null,
        municipalityId: 'mun-9',
        contactPhone: null,
      });

      await service.checkout(makeClient(), { addressId: 'addr-1' });

      expect(clientAddressesService.findOneForClient).toHaveBeenCalledWith(
        'client-1',
        'addr-1',
      );
      expect(orderRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          deliveryMunicipalityId: 'mun-9',
          deliveryAddress: expect.objectContaining({
            street: 'Calle 23 #456',
            municipalityId: 'mun-9',
            municipalityName: 'Báguanos',
            provinceName: 'Holguín',
          }),
        }),
      );
    });

    it('does not touch the address book when checkout fails', async () => {
      cartService.getCart.mockResolvedValue({
        items: [{ ...cartLine, isAvailable: false, available: 0 }],
        totalItems: 2,
        subtotal: 15,
      });

      await expect(
        service.checkout(makeClient(), {
          address: { street: 'Calle nueva', municipalityId: 'mun-9' },
          saveAddress: true,
        }),
      ).rejects.toBeInstanceOf(ConflictException);

      expect(clientAddressesService.create).not.toHaveBeenCalled();
    });

    it('saves a new address only when the customer asked for it', async () => {
      const address = { street: 'Calle nueva', municipalityId: 'mun-9' };

      await service.checkout(makeClient(), { address });
      expect(clientAddressesService.create).not.toHaveBeenCalled();

      clientAddressesService.create.mockResolvedValue({
        ...address,
        id: 'addr-2',
        clientId: 'client-1',
      });
      await service.checkout(makeClient(), { address, saveAddress: true });

      expect(clientAddressesService.create).toHaveBeenCalledTimes(1);
      expect(clientAddressesService.create).toHaveBeenCalledWith(
        'client-1',
        address,
      );
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

    it('does not make the customer wait for the gateway', async () => {
      // The attempt is created in the background: checkout resolves without it.
      let release: (value: unknown) => void = () => {};
      paymentsService.createChargeForOrder.mockReturnValue(
        new Promise((resolve) => {
          release = resolve;
        }),
      );

      const result = await service.checkout(makeClient(), {});

      expect(result.status).toBe(OrderStatus.PENDING);
      expect(paymentsService.createChargeForOrder).toHaveBeenCalled();
      release({ id: 'charge-1' });
    });

    it('rejects an unknown payment method before creating anything', async () => {
      paymentMethodsService.resolve.mockRejectedValue(
        new BadRequestException('nope'),
      );

      await expect(
        service.checkout(makeClient(), { paymentMethod: 'ghost' }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(orderRepo.save).not.toHaveBeenCalled();
      expect(inventoryService.reserve).not.toHaveBeenCalled();
    });

    it('survives a payment-initiation failure: order stays pending', async () => {
      paymentsService.createChargeForOrder.mockRejectedValue(
        new Error('gateway down'),
      );

      const result = await service.checkout(makeClient(), {});

      // Order + reservations + cart clear all committed regardless.
      expect(inventoryService.reserve).toHaveBeenCalled();
      expect(cartItemRepo.delete).toHaveBeenCalled();
      expect(result.status).toBe(OrderStatus.PENDING);
      expect(result.paymentStatus).toBe(PaymentStatus.PENDING);
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

  describe('findForClient', () => {
    it('labels each listed order with the method it was paid with', async () => {
      orderRepo.findAndCount.mockResolvedValue([[makeOrder()], 1]);
      paymentsService.latestMethodsFor.mockResolvedValue(
        new Map([
          ['order-1', { code: 'tropipay', label: 'Tarjeta (Tropipay)' }],
        ]),
      );

      const result = await service.findForClient('client-1');

      expect(paymentsService.latestMethodsFor).toHaveBeenCalledWith([
        'order-1',
      ]);
      expect(result.data[0].paymentMethod).toEqual({
        code: 'tropipay',
        label: 'Tarjeta (Tropipay)',
      });
    });

    it('leaves the method undefined for an order with no attempt', async () => {
      orderRepo.findAndCount.mockResolvedValue([[makeOrder()], 1]);

      const result = await service.findForClient('client-1');

      expect(result.data[0].paymentMethod).toBeUndefined();
    });

    it('excludes soft-deleted orders', async () => {
      await service.findForClient('client-1');

      expect(orderRepo.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ deletedAt: expect.anything() }),
        }),
      );
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
        'user-1', // acting admin recorded on the sale ledger row
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
        'user-1', // acting admin recorded on the restock ledger row
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

  describe('updatePaymentStatus', () => {
    it('settles a pending payment', async () => {
      orderRepo.findOne
        .mockResolvedValueOnce(makeOrder())
        .mockResolvedValue(makeOrder({ items: [] }));

      await service.updatePaymentStatus('order-1', PaymentStatus.PAID);

      expect(orderRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ paymentStatus: PaymentStatus.PAID }),
      );
    });

    it('rejects nonsense transitions like paid -> pending', async () => {
      orderRepo.findOne.mockResolvedValue(
        makeOrder({ paymentStatus: PaymentStatus.PAID }),
      );

      await expect(
        service.updatePaymentStatus('order-1', PaymentStatus.PENDING),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('allows refunding a paid order', async () => {
      orderRepo.findOne
        .mockResolvedValueOnce(makeOrder({ paymentStatus: PaymentStatus.PAID }))
        .mockResolvedValue(makeOrder({ items: [] }));

      await service.updatePaymentStatus('order-1', PaymentStatus.REFUNDED);

      expect(orderRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ paymentStatus: PaymentStatus.REFUNDED }),
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
