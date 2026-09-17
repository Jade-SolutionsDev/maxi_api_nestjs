import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { CartService } from '../cart/cart.service';
import { CartItem } from '../cart/entities/cart-item.entity';
import { Client } from '../clients/entities/client.entity';
import { InventoryService } from '../inventory/inventory.service';
import { ProductsService } from '../products/products.service';
import { Role, User } from '../users/entities/user.entity';
import { OrderItem } from './entities/order-item.entity';
import {
  CancellationReason,
  Order,
  OrderStatus,
  PaymentStatus,
} from './entities/order.entity';
import { OrdersService } from './orders.service';
import { ClientAddressesService } from '../client-addresses/client-addresses.service';
import { FulfillmentService } from '../fulfillment/fulfillment.service';
import { GeographyService } from '../geography/geography.service';
import { PermissionsService } from '../permissions/permissions.service';
import { PaymentMethodsService } from '../payments/payment-methods.service';
import { PaymentsService } from '../payments/payments.service';
import { OrderEventsService } from '../order-events/order-events.service';
import { OrderMailerService } from '../mail/order-mailer.service';
import { OrderEventKind } from '../order-events/entities/order-event.entity';

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

const contacto = {
  recipientName: 'Daniel Smith',
  idCard: '91031512345',
  contactPhone: '55512345',
};

describe('OrdersService', () => {
  let service: OrdersService;
  let orderRepo: {
    findOne: jest.Mock;
    findAndCount: jest.Mock;
    save: jest.Mock;
    create: jest.Mock;
    createQueryBuilder: jest.Mock;
    update: jest.Mock;
    manager: { query: jest.Mock; getRepository: (entity: unknown) => unknown };
  };
  let cartService: { getCart: jest.Mock };
  let inventoryService: {
    reserve: jest.Mock;
    confirmReservations: jest.Mock;
    releaseReservations: jest.Mock;
    releaseProductUnits: jest.Mock;
    confirmProductReservations: jest.Mock;
  };
  let productsService: {
    coveringLocationIds: jest.Mock;
    findOne: jest.Mock;
  };
  let paymentsService: {
    createChargeForOrder: jest.Mock;
    latestChargeDto: jest.Mock;
    latestMethodsFor: jest.Mock;
    listChargesFor: jest.Mock;
    removeAttempt: jest.Mock;
    toDto: jest.Mock;
  };
  let paymentMethodsService: { resolve: jest.Mock };
  let fulfillmentService: { resolveChoice: jest.Mock };
  let clientAddressesService: {
    findOneForClient: jest.Mock;
    create: jest.Mock;
  };
  let permissionsService: { hasPermission: jest.Mock };
  let orderEvents: { record: jest.Mock; listForOrder: jest.Mock };
  let mailer: { paymentReceived: jest.Mock };
  let orderItemRepo: {
    save: jest.Mock;
    create: jest.Mock;
    find: jest.Mock;
    remove: jest.Mock;
  };
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
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      // El servicio lee las líneas por su propio repositorio, nunca como
      // relación cargada del pedido.
      manager: {
        query: jest.fn().mockResolvedValue([]),
        getRepository: (entity: unknown) =>
          entity === OrderItem ? orderItemRepo : orderRepo,
      },
    };
    orderItemRepo = {
      save: jest.fn().mockImplementation((o: unknown) => Promise.resolve(o)),
      create: jest.fn().mockImplementation((o: unknown) => o),
      find: jest.fn().mockResolvedValue([]),
      remove: jest.fn().mockResolvedValue(undefined),
    };
    cartItemRepo = { delete: jest.fn() };
    cartService = { getCart: jest.fn() };
    inventoryService = {
      reserve: jest.fn(),
      confirmReservations: jest.fn(),
      releaseReservations: jest.fn(),
      releaseProductUnits: jest.fn(),
      confirmProductReservations: jest.fn(),
    };
    productsService = {
      coveringLocationIds: jest.fn().mockResolvedValue(['loc-1']),
      findOne: jest.fn().mockResolvedValue({
        id: 'prod-2',
        name: 'Malta 355ml',
        basePrice: '2.00',
        discount: '0',
        isActive: true,
        deletedAt: null,
      }),
    };
    paymentsService = {
      createChargeForOrder: jest.fn().mockResolvedValue({ id: 'charge-1' }),
      latestChargeDto: jest.fn().mockResolvedValue(undefined),
      latestMethodsFor: jest.fn().mockResolvedValue(new Map()),
      listChargesFor: jest.fn().mockResolvedValue([]),
      removeAttempt: jest.fn(),
      toDto: jest.fn().mockImplementation((c: unknown) => c),
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
    // Direct-jump is permission-based now. Mirror the real hasPermission
    // contract: admins bypass; staff are denied unless a test grants it.
    permissionsService = {
      hasPermission: jest
        .fn()
        .mockImplementation((_userId: string, role: Role) =>
          Promise.resolve(role === Role.SUPER_ADMIN || role === Role.ADMIN),
        ),
    };
    mailer = { paymentReceived: jest.fn().mockResolvedValue(null) };
    orderEvents = {
      record: jest.fn().mockResolvedValue(undefined),
      listForOrder: jest.fn().mockResolvedValue([]),
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
        { provide: ProductsService, useValue: productsService },
        { provide: ClientAddressesService, useValue: clientAddressesService },
        { provide: GeographyService, useValue: geographyService },
        { provide: PermissionsService, useValue: permissionsService },
        { provide: OrderEventsService, useValue: orderEvents },
        { provide: OrderMailerService, useValue: mailer },
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
        {
          allowedLocationIds: ['loc-1'],
          preferredLocationId: undefined,
        },
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

      await service.checkout(makeClient(), { contact: contacto });

      expect(cartService.getCart).toHaveBeenCalledWith('client-1', {
        municipalityId: 'mun-1',
      });
      expect(inventoryService.reserve).toHaveBeenCalledWith(
        expect.anything(),
        'order-1',
        'prod-1',
        2,
        {
          allowedLocationIds: ['loc-1'],
          preferredLocationId: 'loc-1',
        },
      );
      expect(orderRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          fulfillmentType: 'pickup',
          pickupLocationId: 'loc-1',
        }),
      );
    });

    it('guarda a quien recoge, que en una recogida no viene de ninguna dirección', async () => {
      fulfillmentService.resolveChoice.mockResolvedValue({
        type: 'pickup',
        fee: '0.00',
        deliveryOptionId: null,
        deliveryOptionLabel: null,
        pickupLocationId: 'loc-1',
        pickupAddressId: 'pick-1',
        pickupAddressSnapshot: { address: 'Calle 1' },
      });

      await service.checkout(makeClient(), { contact: contacto });

      expect(orderRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ contactSnapshot: contacto }),
      );
    });

    it('rechaza una recogida sin datos de quien la recoge', async () => {
      fulfillmentService.resolveChoice.mockResolvedValue({
        type: 'pickup',
        fee: '0.00',
        deliveryOptionId: null,
        deliveryOptionLabel: null,
        pickupLocationId: 'loc-1',
        pickupAddressId: 'pick-1',
        pickupAddressSnapshot: { address: 'Calle 1' },
      });

      await expect(service.checkout(makeClient(), {})).rejects.toThrow(
        /quien recoge/i,
      );
      // Y no deja un pedido a medias: nada llegó a escribirse.
      expect(orderRepo.save).not.toHaveBeenCalled();
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

  describe('findOneAdmin', () => {
    it('groups the misplaced reserved lines by source storage', async () => {
      orderRepo.findOne.mockResolvedValue(
        makeOrder({
          fulfillmentType: 'pickup',
          pickupLocationId: 'loc-B',
          items: [
            {
              productId: 'prod-1',
              productNameSnapshot: 'Leche Entera 1 L',
              quantity: 1,
            },
            {
              productId: 'prod-2',
              productNameSnapshot: 'Aceite de Oliva 500 ml',
              quantity: 1,
            },
          ],
        } as never),
      );
      orderRepo.manager.query.mockResolvedValue([
        {
          location_id: 'loc-A',
          name: 'Gasd',
          product_id: 'prod-1',
          status: 'reserved',
          quantity: 1,
        },
        {
          location_id: 'loc-B',
          name: 'Central',
          product_id: 'prod-2',
          status: 'reserved',
          quantity: 1,
        },
      ]);

      const dto = await service.findOneAdmin('order-1');

      expect(dto.needsTransfer).toBe(true);
      expect(dto.pendingTransfers).toEqual([
        {
          locationId: 'loc-A',
          locationName: 'Gasd',
          items: [
            { productId: 'prod-1', name: 'Leche Entera 1 L', quantity: 1 },
          ],
        },
      ]);
      expect(dto.reservationStorages).toHaveLength(2);
    });

    it('reports no transfer when every reserved line sits at the counter', async () => {
      orderRepo.findOne.mockResolvedValue(
        makeOrder({
          fulfillmentType: 'pickup',
          pickupLocationId: 'loc-B',
          items: [],
        } as never),
      );
      orderRepo.manager.query.mockResolvedValue([
        {
          location_id: 'loc-B',
          name: 'Central',
          product_id: 'prod-1',
          status: 'reserved',
          quantity: 2,
        },
      ]);

      const dto = await service.findOneAdmin('order-1');

      expect(dto.needsTransfer).toBe(false);
      expect(dto.pendingTransfers).toEqual([]);
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

    it('forbids non-admin staff from confirming or cancelling', async () => {
      await expect(
        service.updateStatus(
          makeUser(Role.STAFF),
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
          makeUser(Role.STAFF),
          'order-1',
          OrderStatus.CANCELLED,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('lets staff advance fulfillment', async () => {
      orderRepo.findOne.mockReset();
      orderRepo.findOne
        .mockResolvedValueOnce(makeOrder({ status: OrderStatus.CONFIRMED }))
        .mockResolvedValue(makeOrder({ items: [] }));

      await service.updateStatus(
        makeUser(Role.STAFF),
        'order-1',
        OrderStatus.PROCESSING,
      );

      expect(orderRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ status: OrderStatus.PROCESSING }),
      );
    });
  });

  describe('updateStatus (direct jump)', () => {
    beforeEach(() => {
      orderRepo.findOne
        .mockResolvedValueOnce(makeOrder()) // pending
        .mockResolvedValue(makeOrder({ items: [] }));
    });

    it('pending -> delivered commits the reservations exactly once', async () => {
      await service.updateStatus(
        makeUser(Role.ADMIN),
        'order-1',
        OrderStatus.DELIVERED,
        true,
      );

      expect(inventoryService.confirmReservations).toHaveBeenCalledTimes(1);
      expect(orderRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ status: OrderStatus.DELIVERED }),
      );
    });

    it('confirmed -> delivered does not re-commit stock', async () => {
      orderRepo.findOne.mockReset();
      orderRepo.findOne
        .mockResolvedValueOnce(makeOrder({ status: OrderStatus.CONFIRMED }))
        .mockResolvedValue(makeOrder({ items: [] }));

      permissionsService.hasPermission.mockResolvedValue(true);
      await service.updateStatus(
        makeUser(Role.STAFF),
        'order-1',
        OrderStatus.DELIVERED,
        true,
      );

      expect(inventoryService.confirmReservations).not.toHaveBeenCalled();
      expect(orderRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ status: OrderStatus.DELIVERED }),
      );
    });

    it('jumping to cancelled releases the reservations', async () => {
      orderRepo.findOne.mockReset();
      orderRepo.findOne
        .mockResolvedValueOnce(makeOrder({ status: OrderStatus.SHIPPED }))
        .mockResolvedValue(makeOrder({ items: [] }));

      await service.updateStatus(
        makeUser(Role.ADMIN),
        'order-1',
        OrderStatus.CANCELLED,
        true,
      );

      expect(inventoryService.releaseReservations).toHaveBeenCalledTimes(1);
    });

    it('lets staff with the direct permission jump past confirm (manual in-store sale)', async () => {
      permissionsService.hasPermission.mockResolvedValue(true);
      await service.updateStatus(
        makeUser(Role.STAFF),
        'order-1',
        OrderStatus.DELIVERED,
        true,
      );

      expect(permissionsService.hasPermission).toHaveBeenCalledWith(
        'user-1',
        Role.STAFF,
        'orders',
        'update-status-direct',
      );
      expect(inventoryService.confirmReservations).toHaveBeenCalledTimes(1);
    });

    it('rejects staff without the direct permission', async () => {
      await expect(
        service.updateStatus(
          makeUser(Role.STAFF),
          'order-1',
          OrderStatus.DELIVERED,
          true,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('never moves backwards', async () => {
      orderRepo.findOne.mockReset();
      orderRepo.findOne.mockResolvedValue(
        makeOrder({ status: OrderStatus.SHIPPED }),
      );

      await expect(
        service.updateStatus(
          makeUser(Role.ADMIN),
          'order-1',
          OrderStatus.CONFIRMED,
          true,
        ),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('never leaves a terminal state', async () => {
      orderRepo.findOne.mockReset();
      orderRepo.findOne.mockResolvedValue(
        makeOrder({ status: OrderStatus.CANCELLED }),
      );

      await expect(
        service.updateStatus(
          makeUser(Role.ADMIN),
          'order-1',
          OrderStatus.DELIVERED,
          true,
        ),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('updatePaymentStatus', () => {
    it('settles a pending payment', async () => {
      orderRepo.findOne
        .mockResolvedValueOnce(makeOrder())
        .mockResolvedValue(makeOrder({ items: [] }));

      await service.updatePaymentStatus(
        makeUser(Role.ADMIN),
        'order-1',
        PaymentStatus.PAID,
      );

      expect(orderRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ paymentStatus: PaymentStatus.PAID }),
      );
    });

    it('rejects nonsense transitions like paid -> pending', async () => {
      orderRepo.findOne.mockResolvedValue(
        makeOrder({ paymentStatus: PaymentStatus.PAID }),
      );

      await expect(
        service.updatePaymentStatus(
          makeUser(Role.ADMIN),
          'order-1',
          PaymentStatus.PENDING,
        ),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('sella la fecha de cobro y avisa al cliente al marcar pagado a mano', async () => {
      orderRepo.findOne.mockResolvedValue(
        makeOrder({ paymentStatus: PaymentStatus.PENDING }),
      );

      await service.updatePaymentStatus(
        makeUser(Role.ADMIN),
        'order-1',
        PaymentStatus.PAID,
      );

      const saved = orderRepo.save.mock.calls[0][0] as { paidAt: Date | null };
      expect(saved.paidAt).toBeInstanceOf(Date);
      expect(mailer.paymentReceived).toHaveBeenCalledWith('order-1');
    });

    it('corregir a reembolsado no manda el aviso de pago recibido', async () => {
      orderRepo.findOne.mockResolvedValue(
        makeOrder({ paymentStatus: PaymentStatus.PAID }),
      );

      await service.updatePaymentStatus(
        makeUser(Role.ADMIN),
        'order-1',
        PaymentStatus.REFUNDED,
      );

      expect(mailer.paymentReceived).not.toHaveBeenCalled();
    });

    it('allows refunding a paid order', async () => {
      orderRepo.findOne
        .mockResolvedValueOnce(makeOrder({ paymentStatus: PaymentStatus.PAID }))
        .mockResolvedValue(makeOrder({ items: [] }));

      await service.updatePaymentStatus(
        makeUser(Role.ADMIN),
        'order-1',
        PaymentStatus.REFUNDED,
      );

      expect(orderRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ paymentStatus: PaymentStatus.REFUNDED }),
      );
    });
  });

  describe('reinstate («Restablecer orden»)', () => {
    const admin = makeUser(Role.ADMIN);
    const expired = () =>
      makeOrder({
        status: OrderStatus.CANCELLED,
        cancellationReason: CancellationReason.PAYMENT_NOT_RECEIVED,
        pickupLocationId: 'loc-counter',
        createdAt: new Date(Date.now() - 12 * 24 * 3_600_000),
      });
    const lines = [
      {
        productId: 'prod-1',
        quantity: 1,
        productNameSnapshot: 'Balita de gas',
      },
      { productId: 'prod-2', quantity: 3, productNameSnapshot: 'Cerveza' },
    ];

    beforeEach(() => {
      orderItemRepo.find.mockResolvedValue(lines);
      orderRepo.findOne
        .mockResolvedValueOnce(expired())
        .mockResolvedValue(makeOrder({ items: [] }));
    });

    it('re-reserves every line and puts the order back to pending', async () => {
      await service.reinstate(admin, 'order-1');

      expect(inventoryService.reserve).toHaveBeenCalledTimes(2);
      expect(inventoryService.reserve).toHaveBeenCalledWith(
        expect.anything(),
        'order-1',
        'prod-1',
        1,
        expect.objectContaining({ preferredLocationId: 'loc-counter' }),
      );
      const saved = orderRepo.save.mock.calls[0][0] as Order;
      expect(saved.status).toBe(OrderStatus.PENDING);
      expect(saved.cancellationReason).toBeNull();
      expect(saved.reinstatedBy).toBe('user-1');
      expect(saved.reinstatedAt).toBeInstanceOf(Date);
    });

    it('leaves the payment status exactly as it was', async () => {
      await service.reinstate(admin, 'order-1');

      const saved = orderRepo.save.mock.calls[0][0] as Order;
      expect(saved.paymentStatus).toBe(PaymentStatus.PENDING);
    });

    it('409s naming the product when its stock is gone, without saving', async () => {
      inventoryService.reserve
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new ConflictException('Insufficient stock'));

      await expect(service.reinstate(admin, 'order-1')).rejects.toThrow(
        /Cerveza/,
      );
      expect(orderRepo.save).not.toHaveBeenCalled();
    });

    it('refuses an order that is not cancelled', async () => {
      orderRepo.findOne.mockReset();
      orderRepo.findOne.mockResolvedValue(makeOrder());

      await expect(service.reinstate(admin, 'order-1')).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(inventoryService.reserve).not.toHaveBeenCalled();
    });

    it('refuses the paid-after-expiry case, which needs a refund instead', async () => {
      orderRepo.findOne.mockReset();
      orderRepo.findOne.mockResolvedValue(
        makeOrder({
          status: OrderStatus.CANCELLED,
          cancellationReason: CancellationReason.PAID_AFTER_EXPIRY_OUT_OF_STOCK,
        }),
      );

      await expect(service.reinstate(admin, 'order-1')).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(inventoryService.reserve).not.toHaveBeenCalled();
    });
  });

  describe('correct (corrección de superadmin)', () => {
    const superAdmin = makeUser(Role.SUPER_ADMIN);
    const reason = 'El cliente pagó por fuera y se registró mal';
    const stubDetail = (order: Order) => {
      orderRepo.findOne
        .mockResolvedValueOnce(order)
        .mockResolvedValue(makeOrder({ items: [] }));
    };

    it('solo la puede hacer un superadministrador, aunque ADMIN pase el guard', async () => {
      stubDetail(makeOrder());
      await expect(
        service.correct(makeUser(Role.ADMIN), 'order-1', {
          status: OrderStatus.CANCELLED,
          reason,
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(orderRepo.save).not.toHaveBeenCalled();
    });

    it('exige que algo cambie', async () => {
      stubDetail(makeOrder());
      await expect(
        service.correct(superAdmin, 'order-1', {
          status: OrderStatus.PENDING,
          paymentStatus: PaymentStatus.PENDING,
          reason,
        }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('de cancelado a pendiente vuelve a apartar y reinicia el plazo', async () => {
      orderItemRepo.find.mockResolvedValue([
        { productId: 'prod-1', quantity: 2, productNameSnapshot: 'Balita' },
      ]);
      stubDetail(makeOrder({ status: OrderStatus.CANCELLED }));

      await service.correct(superAdmin, 'order-1', {
        status: OrderStatus.PENDING,
        reason,
      });

      expect(inventoryService.reserve).toHaveBeenCalledWith(
        expect.anything(),
        'order-1',
        'prod-1',
        2,
        expect.anything(),
      );
      expect(inventoryService.confirmReservations).not.toHaveBeenCalled();
      const saved = orderRepo.save.mock.calls[0][0] as Order;
      expect(saved.status).toBe(OrderStatus.PENDING);
      expect(saved.reinstatedAt).toBeInstanceOf(Date);
      expect(orderEvents.record).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          kind: OrderEventKind.STATUS_CHANGED,
          previousValue: OrderStatus.CANCELLED,
          nextValue: OrderStatus.PENDING,
          reason,
          meta: { correction: true },
        }),
      );
    });

    it('de pendiente a entregado descuenta el stock una vez', async () => {
      stubDetail(makeOrder());
      await service.correct(superAdmin, 'order-1', {
        status: OrderStatus.DELIVERED,
        reason,
      });
      expect(inventoryService.reserve).not.toHaveBeenCalled();
      expect(inventoryService.confirmReservations).toHaveBeenCalledTimes(1);
      expect(inventoryService.releaseReservations).not.toHaveBeenCalled();
    });

    it('de confirmado a pendiente devuelve al almacén y vuelve a apartar', async () => {
      orderItemRepo.find.mockResolvedValue([
        { productId: 'prod-1', quantity: 1, productNameSnapshot: 'Balita' },
      ]);
      stubDetail(makeOrder({ status: OrderStatus.CONFIRMED }));

      await service.correct(superAdmin, 'order-1', {
        status: OrderStatus.PENDING,
        reason,
      });

      expect(inventoryService.releaseReservations).toHaveBeenCalledTimes(1);
      expect(inventoryService.reserve).toHaveBeenCalledTimes(1);
      expect(inventoryService.confirmReservations).not.toHaveBeenCalled();
    });

    it('de entregado a cancelado devuelve al almacén sin volver a apartar', async () => {
      stubDetail(makeOrder({ status: OrderStatus.DELIVERED }));
      await service.correct(superAdmin, 'order-1', {
        status: OrderStatus.CANCELLED,
        reason,
      });
      expect(inventoryService.releaseReservations).toHaveBeenCalledTimes(1);
      expect(inventoryService.reserve).not.toHaveBeenCalled();
    });

    it('entre estados de la misma fase no toca el stock', async () => {
      stubDetail(makeOrder({ status: OrderStatus.SHIPPED }));
      await service.correct(superAdmin, 'order-1', {
        status: OrderStatus.PROCESSING,
        reason,
      });
      expect(inventoryService.reserve).not.toHaveBeenCalled();
      expect(inventoryService.confirmReservations).not.toHaveBeenCalled();
      expect(inventoryService.releaseReservations).not.toHaveBeenCalled();
      const saved = orderRepo.save.mock.calls[0][0] as Order;
      expect(saved.status).toBe(OrderStatus.PROCESSING);
    });

    it('permite pagado → pendiente, que el flujo normal prohíbe, y reinicia el plazo', async () => {
      stubDetail(makeOrder({ paymentStatus: PaymentStatus.PAID }));
      await service.correct(superAdmin, 'order-1', {
        paymentStatus: PaymentStatus.PENDING,
        reason,
      });
      const saved = orderRepo.save.mock.calls[0][0] as Order;
      expect(saved.paymentStatus).toBe(PaymentStatus.PENDING);
      expect(saved.reinstatedAt).toBeInstanceOf(Date);
      expect(orderEvents.record).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          kind: OrderEventKind.PAYMENT_STATUS_CHANGED,
          previousValue: PaymentStatus.PAID,
          nextValue: PaymentStatus.PENDING,
        }),
      );
    });

    it('409 nombrando el producto cuando no hay stock para volver a apartar', async () => {
      orderItemRepo.find.mockResolvedValue([
        { productId: 'prod-1', quantity: 5, productNameSnapshot: 'Cerveza' },
      ]);
      inventoryService.reserve.mockRejectedValueOnce(
        new ConflictException('Insufficient stock'),
      );
      stubDetail(makeOrder({ status: OrderStatus.CANCELLED }));

      await expect(
        service.correct(superAdmin, 'order-1', {
          status: OrderStatus.PENDING,
          reason,
        }),
      ).rejects.toThrow(/Cerveza/);
      expect(orderRepo.save).not.toHaveBeenCalled();
    });
  });

  describe('updateItems (líneas del pedido, superadmin)', () => {
    const superAdmin = makeUser(Role.SUPER_ADMIN);
    const reason = 'El cliente cambió el pedido por teléfono';
    // Dos líneas: 2 × 7.50 y 1 × 5.00 = 20.00 de subtotal.
    const linea = (over: Partial<OrderItem> = {}): OrderItem =>
      ({
        id: 'item-1',
        orderId: 'order-1',
        productId: 'prod-1',
        productNameSnapshot: 'Cola 1L',
        unitPrice: '7.50',
        quantity: 2,
        lineTotal: '15.00',
        ...over,
      }) as OrderItem;

    // El pedido se carga SIN sus líneas (ver updateItems): las líneas llegan por
    // su propio repositorio, y por eso se preparan aquí por separado.
    const stubOrder = (over: Partial<Order> = {}, items?: OrderItem[]) => {
      const order = makeOrder({ subtotal: '20.00', total: '20.00', ...over });
      orderItemRepo.find.mockResolvedValue(
        items ?? [
          linea(),
          linea({
            id: 'item-2',
            productId: 'prod-3',
            productNameSnapshot: 'Pan',
            unitPrice: '5.00',
            quantity: 1,
            lineTotal: '5.00',
          }),
        ],
      );
      orderRepo.findOne
        .mockResolvedValueOnce(order)
        .mockResolvedValue(makeOrder({ items: [] }));
      return order;
    };

    it('solo la puede hacer un superadministrador, aunque ADMIN pase el guard', async () => {
      stubOrder();
      await expect(
        service.updateItems(makeUser(Role.ADMIN), 'order-1', {
          items: [{ productId: 'prod-1', quantity: 3 }],
          reason,
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(orderRepo.save).not.toHaveBeenCalled();
    });

    it('rechaza el mismo producto en dos líneas', async () => {
      await expect(
        service.updateItems(superAdmin, 'order-1', {
          items: [
            { productId: 'prod-1', quantity: 1 },
            { productId: 'prod-1', quantity: 2 },
          ],
          reason,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('exige que algo cambie', async () => {
      stubOrder();
      await expect(
        service.updateItems(superAdmin, 'order-1', {
          items: [
            { productId: 'prod-1', quantity: 2 },
            { productId: 'prod-3', quantity: 1 },
          ],
          reason,
        }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('subir una cantidad en un pedido pendiente aparta solo la diferencia', async () => {
      stubOrder();
      await service.updateItems(superAdmin, 'order-1', {
        items: [
          { productId: 'prod-1', quantity: 5 },
          { productId: 'prod-3', quantity: 1 },
        ],
        reason,
      });
      expect(inventoryService.reserve).toHaveBeenCalledWith(
        expect.anything(),
        'order-1',
        'prod-1',
        3, // 5 - 2, no 5
        expect.anything(),
      );
      expect(
        inventoryService.confirmProductReservations,
      ).not.toHaveBeenCalled();
      expect(inventoryService.releaseProductUnits).not.toHaveBeenCalled();
    });

    it('bajar una cantidad en un pedido pendiente suelta solo la diferencia', async () => {
      stubOrder();
      await service.updateItems(superAdmin, 'order-1', {
        items: [
          { productId: 'prod-1', quantity: 1 },
          { productId: 'prod-3', quantity: 1 },
        ],
        reason,
      });
      expect(inventoryService.releaseProductUnits).toHaveBeenCalledWith(
        expect.anything(),
        'order-1',
        'prod-1',
        1, // 2 - 1
        'user-1',
      );
      expect(inventoryService.reserve).not.toHaveBeenCalled();
    });

    it('en un pedido confirmado, lo que sube se aparta y se descuenta', async () => {
      stubOrder({ status: OrderStatus.CONFIRMED });
      await service.updateItems(superAdmin, 'order-1', {
        items: [
          { productId: 'prod-1', quantity: 4 },
          { productId: 'prod-3', quantity: 1 },
        ],
        reason,
      });
      expect(inventoryService.reserve).toHaveBeenCalledWith(
        expect.anything(),
        'order-1',
        'prod-1',
        2,
        expect.anything(),
      );
      expect(inventoryService.confirmProductReservations).toHaveBeenCalledWith(
        expect.anything(),
        'order-1',
        'prod-1',
        'user-1',
      );
    });

    it('en un pedido cancelado no se toca el stock', async () => {
      stubOrder({ status: OrderStatus.CANCELLED });
      await service.updateItems(superAdmin, 'order-1', {
        items: [{ productId: 'prod-1', quantity: 9 }],
        reason,
      });
      expect(inventoryService.reserve).not.toHaveBeenCalled();
      expect(inventoryService.releaseProductUnits).not.toHaveBeenCalled();
      expect(
        inventoryService.confirmProductReservations,
      ).not.toHaveBeenCalled();
    });

    it('quitar una línea la borra y suelta todas sus unidades', async () => {
      stubOrder();
      await service.updateItems(superAdmin, 'order-1', {
        items: [{ productId: 'prod-1', quantity: 2 }],
        reason,
      });
      expect(inventoryService.releaseProductUnits).toHaveBeenCalledWith(
        expect.anything(),
        'order-1',
        'prod-3',
        1,
        'user-1',
      );
      expect(orderItemRepo.remove).toHaveBeenCalledTimes(1);
    });

    it('añadir un producto toma nombre y precio del catálogo', async () => {
      stubOrder();
      await service.updateItems(superAdmin, 'order-1', {
        items: [
          { productId: 'prod-1', quantity: 2 },
          { productId: 'prod-3', quantity: 1 },
          { productId: 'prod-2', quantity: 3 },
        ],
        reason,
      });
      expect(orderItemRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          productId: 'prod-2',
          productNameSnapshot: 'Malta 355ml',
          unitPrice: '2.00',
          quantity: 3,
          lineTotal: '6.00',
        }),
      );
    });

    it('un precio a mano manda sobre el del catálogo', async () => {
      stubOrder();
      await service.updateItems(superAdmin, 'order-1', {
        items: [
          { productId: 'prod-1', quantity: 2 },
          { productId: 'prod-3', quantity: 1 },
          { productId: 'prod-2', quantity: 2, unitPrice: 1.25 },
        ],
        reason,
      });
      expect(orderItemRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ productId: 'prod-2', unitPrice: '1.25' }),
      );
    });

    it('no deja añadir un producto que no está a la venta', async () => {
      productsService.findOne.mockResolvedValue({
        id: 'prod-2',
        name: 'Malta 355ml',
        basePrice: '2.00',
        discount: '0',
        isActive: false,
        deletedAt: null,
      });
      stubOrder();
      await expect(
        service.updateItems(superAdmin, 'order-1', {
          items: [
            { productId: 'prod-1', quantity: 2 },
            { productId: 'prod-3', quantity: 1 },
            { productId: 'prod-2', quantity: 1 },
          ],
          reason,
        }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(orderRepo.save).not.toHaveBeenCalled();
    });

    it('recalcula subtotal y total respetando el envío', async () => {
      stubOrder({ deliveryFee: '3.00', subtotal: '20.00', total: '23.00' });
      await service.updateItems(superAdmin, 'order-1', {
        items: [
          { productId: 'prod-1', quantity: 4 }, // 30.00
          { productId: 'prod-3', quantity: 1 }, //  5.00
        ],
        reason,
      });
      expect(orderRepo.update).toHaveBeenCalledWith('order-1', {
        subtotal: '35.00',
        total: '38.00',
      });
    });

    // La regresión de ORD-20260134 en staging: la línea nueva se insertaba y
    // acto seguido desaparecía, porque el pedido se guardaba como entidad con
    // su colección de líneas cargada y TypeORM la reconciliaba contra la base.
    // El pedido se actualiza por campos y jamás se guarda con `items` encima.
    it('no guarda el pedido como entidad, para no llevarse por delante la línea nueva', async () => {
      stubOrder();
      await service.updateItems(superAdmin, 'order-1', {
        items: [
          { productId: 'prod-1', quantity: 2 },
          { productId: 'prod-3', quantity: 1 },
          { productId: 'prod-2', quantity: 1 },
        ],
        reason,
      });
      expect(orderRepo.update).toHaveBeenCalled();
      expect(orderRepo.save).not.toHaveBeenCalled();
      // Y la línea nueva se inserta de verdad.
      expect(orderItemRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ productId: 'prod-2', quantity: 1 }),
      );
    });

    it('lee las líneas por su repositorio, no como relación del pedido', async () => {
      stubOrder();
      await service.updateItems(superAdmin, 'order-1', {
        items: [{ productId: 'prod-1', quantity: 2 }],
        reason,
      });
      expect(orderItemRepo.find).toHaveBeenCalledWith({
        where: { orderId: 'order-1' },
      });
      // findOne del pedido, sin pedir la relación items.
      const [args] = orderRepo.findOne.mock.calls[0] as [
        { relations?: unknown },
      ];
      expect(args.relations).toBeUndefined();
    });

    it('deja el cambio y la diferencia en el historial', async () => {
      stubOrder();
      await service.updateItems(superAdmin, 'order-1', {
        items: [
          { productId: 'prod-1', quantity: 1 },
          { productId: 'prod-3', quantity: 1 },
        ],
        reason,
      });
      expect(orderEvents.record).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          kind: OrderEventKind.ITEMS_CHANGED,
          reason,
          meta: expect.objectContaining({
            correction: true,
            changes: [
              expect.objectContaining({
                type: 'quantity',
                productId: 'prod-1',
                from: 2,
                to: 1,
              }),
            ],
          }),
        }),
      );
      expect(orderEvents.record).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          kind: OrderEventKind.TOTAL_CHANGED,
          previousValue: '20.00',
          nextValue: '12.50',
        }),
      );
    });

    it('con el pedido pagado, anota cuánto hay que devolver', async () => {
      stubOrder({ paymentStatus: PaymentStatus.PAID });
      await service.updateItems(superAdmin, 'order-1', {
        items: [
          { productId: 'prod-1', quantity: 1 },
          { productId: 'prod-3', quantity: 1 },
        ],
        reason,
      });
      expect(orderEvents.record).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          kind: OrderEventKind.TOTAL_CHANGED,
          meta: expect.objectContaining({ paidDifference: '-7.50' }),
        }),
      );
    });

    it('si falta stock para subir una línea, nombra el producto y no guarda', async () => {
      stubOrder();
      inventoryService.reserve.mockRejectedValue(
        new ConflictException('Insufficient stock: only 1 available'),
      );
      await expect(
        service.updateItems(superAdmin, 'order-1', {
          items: [
            { productId: 'prod-1', quantity: 40 },
            { productId: 'prod-3', quantity: 1 },
          ],
          reason,
        }),
      ).rejects.toThrow(/Cola 1L/);
      expect(orderRepo.save).not.toHaveBeenCalled();
    });

    it('suelta antes de apartar, para que un cambio de producto no falle por su propio hueco', async () => {
      stubOrder();
      const orden: string[] = [];
      inventoryService.releaseProductUnits.mockImplementation(() => {
        orden.push('release');
        return Promise.resolve();
      });
      inventoryService.reserve.mockImplementation(() => {
        orden.push('reserve');
        return Promise.resolve();
      });
      await service.updateItems(superAdmin, 'order-1', {
        items: [
          { productId: 'prod-1', quantity: 1 },
          { productId: 'prod-3', quantity: 4 },
        ],
        reason,
      });
      expect(orden).toEqual(['release', 'reserve']);
    });
  });

  describe('intentos de pago (superadmin)', () => {
    const superAdmin = makeUser(Role.SUPER_ADMIN);

    it('quita un intento no completado, limpia la referencia y lo anota', async () => {
      orderRepo.findOne
        .mockResolvedValueOnce(makeOrder({ paymentRef: 'REF-1' }))
        .mockResolvedValue(makeOrder({ items: [] }));
      paymentsService.removeAttempt.mockResolvedValue({
        id: 'charge-1',
        provider: 'tropipay',
        reference: 'REF-1',
        status: 'REQUIRES_ACTION',
      });

      await service.removePaymentAttempt(
        superAdmin,
        'order-1',
        'charge-1',
        'Enlace que el cliente nunca abrió',
      );

      expect(paymentsService.removeAttempt).toHaveBeenCalledWith(
        'order-1',
        'charge-1',
      );
      const saved = orderRepo.save.mock.calls[0][0] as Order;
      expect(saved.paymentRef).toBeNull();
      expect(orderEvents.record).toHaveBeenCalledWith(
        null,
        expect.objectContaining({
          kind: OrderEventKind.PAYMENT_ATTEMPT_REMOVED,
          meta: expect.objectContaining({ provider: 'tropipay' }),
        }),
      );
    });

    it('lo niega a quien no sea superadministrador', async () => {
      await expect(
        service.removePaymentAttempt(
          makeUser(Role.ADMIN),
          'order-1',
          'charge-1',
          'motivo',
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(paymentsService.removeAttempt).not.toHaveBeenCalled();
    });

    it('lista los intentos convertidos a DTO', async () => {
      orderRepo.findOne.mockResolvedValue(makeOrder());
      paymentsService.listChargesFor.mockResolvedValue([{ id: 'c1' }]);
      expect(await service.listPaymentAttempts('order-1')).toEqual([
        { id: 'c1' },
      ]);
    });
  });

  describe('historial del pedido', () => {
    it('anota quién cambió el estado, y de qué a qué', async () => {
      orderRepo.findOne
        .mockResolvedValueOnce(makeOrder())
        .mockResolvedValue(makeOrder({ items: [] }));

      await service.updateStatus(
        makeUser(Role.ADMIN),
        'order-1',
        OrderStatus.CONFIRMED,
      );

      expect(orderEvents.record).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          orderId: 'order-1',
          kind: OrderEventKind.STATUS_CHANGED,
          actor: { userId: 'user-1' },
          field: 'status',
          previousValue: OrderStatus.PENDING,
          nextValue: OrderStatus.CONFIRMED,
        }),
      );
    });

    it('anota el cambio de pago hecho a mano por un admin', async () => {
      orderRepo.findOne
        .mockResolvedValueOnce(makeOrder())
        .mockResolvedValue(makeOrder({ items: [] }));

      await service.updatePaymentStatus(
        makeUser(Role.ADMIN),
        'order-1',
        PaymentStatus.PAID,
      );

      expect(orderEvents.record).toHaveBeenCalledWith(
        null,
        expect.objectContaining({
          kind: OrderEventKind.PAYMENT_STATUS_CHANGED,
          actor: { userId: 'user-1' },
          previousValue: PaymentStatus.PENDING,
          nextValue: PaymentStatus.PAID,
        }),
      );
    });

    it('anota el restablecimiento con su motivo', async () => {
      orderItemRepo.find.mockResolvedValue([]);
      orderRepo.findOne
        .mockResolvedValueOnce(
          makeOrder({
            status: OrderStatus.CANCELLED,
            cancellationReason: CancellationReason.PAYMENT_NOT_RECEIVED,
          }),
        )
        .mockResolvedValue(makeOrder({ items: [] }));

      await service.reinstate(makeUser(Role.ADMIN), 'order-1');

      expect(orderEvents.record).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          kind: OrderEventKind.REINSTATED,
          previousValue: OrderStatus.CANCELLED,
          nextValue: OrderStatus.PENDING,
        }),
      );
    });

    it('anota la cancelación hecha por el cliente', async () => {
      orderRepo.findOne
        .mockResolvedValueOnce(makeOrder())
        .mockResolvedValue(makeOrder({ items: [] }));

      await service.cancelByClient('client-1', 'order-1');

      expect(orderEvents.record).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          kind: OrderEventKind.STATUS_CHANGED,
          actor: { clientId: 'client-1' },
          nextValue: OrderStatus.CANCELLED,
        }),
      );
    });

    it('lista el historial solo de pedidos que existen', async () => {
      orderRepo.findOne.mockResolvedValue(null);
      await expect(service.listEvents('nope')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(orderEvents.listForOrder).not.toHaveBeenCalled();
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
