import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Logger,
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
  FulfillmentType,
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
  let mailer: {
    orderReceived: jest.Mock;
    paymentReceived: jest.Mock;
    shipped: jest.Mock;
    delivered: jest.Mock;
    cancelled: jest.Mock;
  };
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
    mailer = {
      orderReceived: jest.fn().mockResolvedValue(null),
      paymentReceived: jest.fn().mockResolvedValue(null),
      shipped: jest.fn().mockResolvedValue(null),
      delivered: jest.fn().mockResolvedValue(null),
      cancelled: jest.fn().mockResolvedValue(null),
    };
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

    it('el pedido nace en pending, tanto el estado como el pago', async () => {
      await service.checkout(makeClient(), {});

      // Campo a campo, no con objectContaining: es justo lo que la mutación
      // de status: OrderStatus.PENDING -> OrderStatus.CONFIRMED en
      // crearPedido() no rompía antes de esta prueba.
      const pedidoGuardado = orderRepo.save.mock.calls[0][0];
      expect(pedidoGuardado.status).toBe(OrderStatus.PENDING);
      expect(pedidoGuardado.paymentStatus).toBe(PaymentStatus.PENDING);
    });

    it('el subtotal de la cabecera es la suma de los lineTotal de sus líneas', async () => {
      // Dos líneas, no una: si el subtotal viniera de otro lado (por ejemplo,
      // un total pasado por parámetro) y no de sumar estas mismas líneas,
      // aquí divergirían.
      cartService.getCart.mockResolvedValue({
        items: [
          { ...cartLine, productId: 'prod-1', quantity: 3, unitPrice: 0.1 },
          { ...cartLine, productId: 'prod-2', quantity: 1, unitPrice: 2.005 },
        ],
        totalItems: 4,
        subtotal: 2.31,
      });

      await service.checkout(makeClient(), {});

      const pedidoGuardado = orderRepo.save.mock.calls[0][0];
      const centavosDeLasLineas = orderItemRepo.save.mock.calls.reduce(
        (centavos: number, [item]: [{ lineTotal: string }]) =>
          centavos + Math.round(Number(item.lineTotal) * 100),
        0,
      );
      expect(pedidoGuardado.subtotal).toBe(
        (centavosDeLasLineas / 100).toFixed(2),
      );
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

    it('avisa al cliente por correo de que su pedido quedó guardado', async () => {
      await service.checkout(makeClient(), {});

      expect(mailer.orderReceived).toHaveBeenCalled();
    });

    it('un correo que falla no tumba la compra, y queda anotado', async () => {
      // El pedido ya está comprometido cuando se avisa: si el proveedor de
      // correo se cae, la venta no se puede perder por eso.
      //
      // Se comprueba que el fallo quedó ATENDIDO, no solo que el checkout
      // devolvió: sin el `.catch()` el rechazo queda suelto, y un rechazo
      // suelto no hace fallar esta prueba, tumba el proceso entero. Esperar al
      // siguiente tick es lo que deja que la promesa del aviso se asiente
      // dentro de la prueba y no después de ella.
      const anotado = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => undefined);
      mailer.orderReceived.mockRejectedValue(new Error('resend caído'));

      await expect(service.checkout(makeClient(), {})).resolves.toBeDefined();
      await new Promise((sigue) => setImmediate(sigue));

      expect(mailer.orderReceived).toHaveBeenCalled();
      expect(anotado).toHaveBeenCalledWith(
        expect.stringContaining('No se pudo avisar por correo'),
        expect.anything(),
      );
      anotado.mockRestore();
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

  const filtrosFalsos = () => {
    const qb = {
      leftJoinAndSelect: jest.fn(),
      leftJoin: jest.fn(),
      andWhere: jest.fn(),
      orderBy: jest.fn(),
      addOrderBy: jest.fn(),
      skip: jest.fn(),
      take: jest.fn(),
      select: jest.fn(),
      addSelect: jest.fn(),
      groupBy: jest.fn(),
      getCount: jest.fn().mockResolvedValue(0),
      getMany: jest.fn().mockResolvedValue([]),
      getRawMany: jest.fn().mockResolvedValue([]),
      getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
    };
    for (const metodo of [
      'leftJoinAndSelect',
      'leftJoin',
      'andWhere',
      'orderBy',
      'addOrderBy',
      'skip',
      'take',
      'select',
      'addSelect',
      'groupBy',
    ] as const) {
      qb[metodo].mockReturnValue(qb);
    }
    return qb;
  };

  describe('findAllAdmin', () => {
    it('busca pedidos por el nombre completo y teléfono del cliente', async () => {
      const qb = {
        leftJoinAndSelect: jest.fn(),
        andWhere: jest.fn(),
        orderBy: jest.fn(),
        addOrderBy: jest.fn(),
        skip: jest.fn(),
        take: jest.fn(),
        getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
      };
      for (const method of [
        'leftJoinAndSelect',
        'andWhere',
        'orderBy',
        'addOrderBy',
        'skip',
        'take',
      ] as const) {
        qb[method].mockReturnValue(qb);
      }
      orderRepo.createQueryBuilder.mockReturnValue(qb);

      await service.findAllAdmin({ q: 'Aurelio García' });

      const [condition, parameters] = qb.andWhere.mock.calls[0] as [
        string,
        { q: string },
      ];
      expect(condition).toContain(
        "concat_ws(' ', client.firstName, client.lastName)",
      );
      expect(condition).toContain('client.phone');
      expect(parameters).toEqual({ q: '%Aurelio García%' });
    });

    // «Hasta el 24» tiene que incluir los pedidos de esa tarde. Cortar a
    // medianoche del 23 deja fuera un día entero sin que nadie lo note, y el
    // reporte cuadra mal justo el día que se saca.
    it('el rango de fechas incluye el último día completo', async () => {
      const qb = filtrosFalsos();
      orderRepo.createQueryBuilder.mockReturnValue(qb);

      await service.findAllAdmin({ from: '2026-09-01', to: '2026-09-24' });

      const llamadas = qb.andWhere.mock.calls as [
        string,
        Record<string, Date>,
      ][];
      const desde = llamadas.find(([c]) => c.includes('>= :desde'));
      const hasta = llamadas.find(([c]) => c.includes('<= :hasta'));
      expect(desde).toBeDefined();
      expect(hasta).toBeDefined();
      const fin = hasta?.[1].hasta as Date;
      expect(fin.getDate()).toBe(24);
      expect(fin.getHours()).toBe(23);
      expect(fin.getMinutes()).toBe(59);
    });
  });

  describe('los filtros nuevos del reporte', () => {
    it('filtra por tipo de entrega y punto de recogida', async () => {
      const qb = filtrosFalsos();
      orderRepo.createQueryBuilder.mockReturnValue(qb);

      await service.findAllAdmin({
        fulfillmentType: FulfillmentType.PICKUP,
        pickupLocationId: '8325f708-021b-4045-bc92-42c3b90aedfc',
      });

      const condiciones = (qb.andWhere.mock.calls as [string, unknown][]).map(
        ([c]) => c,
      );
      expect(condiciones).toContain('order.fulfillmentType = :fulfillmentType');
      expect(condiciones).toContain(
        'order.pickupLocationId = :pickupLocationId',
      );
    });

    // El total es `decimal`. Pasarlo por el `number` de JavaScript redondea
    // céntimos en importes de cinco cifras —y aquí los hay, hay pedidos de
    // $51.840— y dejaría pedidos fuera del rango por un cent.
    it('compara los importes sin pasarlos por number', async () => {
      const qb = filtrosFalsos();
      orderRepo.createQueryBuilder.mockReturnValue(qb);

      await service.findAllAdmin({ minTotal: '100.00', maxTotal: '51840.55' });

      const llamadas = qb.andWhere.mock.calls as [
        string,
        Record<string, unknown>,
      ][];
      const min = llamadas.find(([c]) => c.includes('>= :minTotal'));
      const max = llamadas.find(([c]) => c.includes('<= :maxTotal'));
      expect(min?.[1].minTotal).toBe('100.00');
      expect(max?.[1].maxTotal).toBe('51840.55');
    });
  });

  describe('el reporte usa los mismos filtros que el listado', () => {
    // Si el reporte armara su propia consulta, acabaría diciendo algo distinto
    // de lo que muestra la pantalla, y un informe que no cuadra con el listado
    // es peor que no tenerlo.
    it('aplica el filtro de estado igual que el listado', async () => {
      const qbListado = filtrosFalsos();
      orderRepo.createQueryBuilder.mockReturnValue(qbListado);
      await service.findAllAdmin({ status: OrderStatus.CANCELLED });
      const delListado = (qbListado.andWhere.mock.calls as [string, unknown][])
        .map(([c]) => c)
        .filter((c) => c.includes('order.status'));

      const qbReporte = filtrosFalsos();
      orderRepo.createQueryBuilder.mockReturnValue(qbReporte);
      paymentsService.latestMethodsFor.mockResolvedValue(new Map());
      await service.findAllForReport({ status: OrderStatus.CANCELLED });
      const delReporte = (qbReporte.andWhere.mock.calls as [string, unknown][])
        .map(([c]) => c)
        .filter((c) => c.includes('order.status'));

      expect(delReporte).toEqual(delListado);
    });

    // El listado enseña de diez en diez; un reporte de la página que estás
    // mirando no es un reporte.
    it('no arrastra la paginación del listado', async () => {
      const qb = filtrosFalsos();
      orderRepo.createQueryBuilder.mockReturnValue(qb);
      paymentsService.latestMethodsFor.mockResolvedValue(new Map());

      await service.findAllForReport({ status: OrderStatus.CANCELLED });

      expect(qb.skip).not.toHaveBeenCalled();
      expect(qb.take).toHaveBeenCalledWith(5000);
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

    // Tres de seis estados avisan al cliente. Los otros tres callan a
    // propósito: de `confirmed` y `processing` ya se enteró por el correo del
    // pago, y tres avisos en una hora es lo que lleva una tienda a spam.
    it('avisa al cliente cuando el pedido sale', async () => {
      await service.updateStatus(
        makeUser(Role.ADMIN),
        'order-1',
        OrderStatus.SHIPPED,
        true,
      );

      expect(mailer.shipped).toHaveBeenCalledWith('order-1');
    });

    it('avisa al cliente cuando se entrega', async () => {
      await service.updateStatus(
        makeUser(Role.ADMIN),
        'order-1',
        OrderStatus.DELIVERED,
        true,
      );

      expect(mailer.delivered).toHaveBeenCalledWith('order-1');
    });

    it('al cancelar pasa el motivo, que elige el texto del correo', async () => {
      await service.updateStatus(
        makeUser(Role.ADMIN),
        'order-1',
        OrderStatus.CANCELLED,
      );

      expect(mailer.cancelled).toHaveBeenCalledWith('order-1', null);
    });

    it('confirmar no genera correo: el cliente ya recibió el del pago', async () => {
      await service.updateStatus(
        makeUser(Role.ADMIN),
        'order-1',
        OrderStatus.CONFIRMED,
      );

      expect(mailer.shipped).not.toHaveBeenCalled();
      expect(mailer.delivered).not.toHaveBeenCalled();
      expect(mailer.cancelled).not.toHaveBeenCalled();
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

  describe('trackByPublicId (seguimiento público del pedido)', () => {
    const TRACK = 'a'.repeat(64);

    const pedido = (over: Partial<Order> = {}) =>
      makeOrder({
        orderNumber: 'ORD-20260134',
        trackingId: TRACK,
        status: OrderStatus.SHIPPED,
        paymentStatus: PaymentStatus.PAID,
        promiseDays: 3,
        promisedAt: new Date('2026-09-20T10:00:00Z'),
        deliveredAt: null,
        fulfillmentType: FulfillmentType.DELIVERY,
        clientId: 'client-1',
        subtotal: '100.00',
        total: '105.00',
        deliveryAddress: { street: 'Calle secreta 123' },
        ...over,
      });

    it('devuelve el estado con el enlace correcto', async () => {
      orderRepo.findOne.mockResolvedValue(pedido());
      orderEvents.listForOrder.mockResolvedValue([
        {
          kind: OrderEventKind.CREATED,
          field: 'status',
          nextValue: 'pending',
          createdAt: new Date('2026-09-15T10:00:00Z'),
        },
        {
          kind: OrderEventKind.PAYMENT_ATTEMPT,
          field: 'paymentRef',
          nextValue: null,
          createdAt: new Date('2026-09-15T10:05:00Z'),
        },
        {
          kind: OrderEventKind.STATUS_CHANGED,
          field: 'status',
          nextValue: 'shipped',
          createdAt: new Date('2026-09-17T09:00:00Z'),
        },
      ]);

      const dto = await service.trackByPublicId(TRACK);

      expect(dto.orderNumber).toBe('ORD-20260134');
      expect(dto.status).toBe('En camino');
      expect(dto.paid).toBe(true);
      expect(dto.promiseDays).toBe(3);
      // El historial solo lleva cambios de estado: el intento de pago se cae.
      expect(dto.history).toEqual([
        { status: 'Pendiente de pago', at: new Date('2026-09-15T10:00:00Z') },
        { status: 'En camino', at: new Date('2026-09-17T09:00:00Z') },
      ]);
    });

    // La prueba que pide la tarjeta: que no se escape nada de más. Se mira el
    // objeto entero, no campo a campo, para que añadir uno nuevo sin pensar
    // haga saltar esto.
    it('no revela datos del cliente, dirección, importes ni productos', async () => {
      orderRepo.findOne.mockResolvedValue(pedido());
      orderEvents.listForOrder.mockResolvedValue([]);

      const dto = await service.trackByPublicId(TRACK);

      expect(Object.keys(dto).sort()).toEqual(
        [
          'deliveredAt',
          'fulfillmentType',
          'history',
          'orderNumber',
          'paid',
          'placedAt',
          'promiseDays',
          'promisedAt',
          'status',
        ].sort(),
      );
      const serializado = JSON.stringify(dto);
      expect(serializado).not.toContain('Calle secreta');
      expect(serializado).not.toContain('client-1');
      expect(serializado).not.toContain('105.00');
      expect(serializado).not.toContain(TRACK);
    });

    // En staging salió un pedido «Cancelado» cuyo historial solo mostraba
    // «Pendiente de pago»: había caducado sin pagarse, y ese evento es `expired`,
    // no `status_changed`. Por el tipo de evento se perdía el final de la
    // historia justo en el caso más común.
    it('incluye la cancelación por caducidad, que no es un cambio de estado normal', async () => {
      orderRepo.findOne.mockResolvedValue(
        pedido({ status: OrderStatus.CANCELLED }),
      );
      orderEvents.listForOrder.mockResolvedValue([
        {
          kind: OrderEventKind.CREATED,
          field: 'status',
          nextValue: 'pending',
          createdAt: new Date('2026-09-18T05:39:37Z'),
        },
        {
          kind: OrderEventKind.EXPIRED,
          field: 'status',
          nextValue: 'cancelled',
          createdAt: new Date('2026-09-19T05:39:37Z'),
        },
      ]);

      const dto = await service.trackByPublicId(TRACK);

      expect(dto.history.map((h) => h.status)).toEqual([
        'Pendiente de pago',
        'Cancelado',
      ]);
    });

    it('un enlace inexistente y uno mal formado responden igual', async () => {
      orderRepo.findOne.mockResolvedValue(null);
      const inexistente = await service
        .trackByPublicId(TRACK)
        .catch((e: Error) => e);
      const malFormado = await service
        .trackByPublicId('no-es-un-identificador')
        .catch((e: Error) => e);

      expect(inexistente).toBeInstanceOf(NotFoundException);
      expect(malFormado).toBeInstanceOf(NotFoundException);
      expect((inexistente as Error).message).toBe(
        (malFormado as Error).message,
      );
    });

    it('un enlace mal formado ni siquiera consulta la base', async () => {
      orderRepo.findOne.mockClear();
      await service.trackByPublicId('AAAA').catch(() => undefined);
      expect(orderRepo.findOne).not.toHaveBeenCalled();
    });

    it('un pedido borrado no se puede seguir', async () => {
      orderRepo.findOne.mockResolvedValue(pedido({ deletedAt: new Date() }));
      await expect(service.trackByPublicId(TRACK)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('traduce cada estado al vocabulario del cliente', async () => {
      orderEvents.listForOrder.mockResolvedValue([]);
      for (const [estado, etiqueta] of [
        [OrderStatus.PENDING, 'Pendiente de pago'],
        [OrderStatus.CONFIRMED, 'Confirmado'],
        [OrderStatus.PROCESSING, 'En preparación'],
        [OrderStatus.DELIVERED, 'Entregado'],
        [OrderStatus.CANCELLED, 'Cancelado'],
      ] as const) {
        orderRepo.findOne.mockResolvedValue(pedido({ status: estado }));
        expect((await service.trackByPublicId(TRACK)).status).toBe(etiqueta);
      }
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
