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
import { Order, OrderStatus, PaymentStatus } from './entities/order.entity';
import { OrdersService } from './orders.service';
import { ClientAddressesService } from '../client-addresses/client-addresses.service';
import { FulfillmentService } from '../fulfillment/fulfillment.service';
import { GeographyService } from '../geography/geography.service';
import { PermissionsService } from '../permissions/permissions.service';
import { PaymentMethodsService } from '../payments/payment-methods.service';
import { PaymentsService } from '../payments/payments.service';
import { OrderEventsService } from '../order-events/order-events.service';
import { OrderMailerService } from '../mail/order-mailer.service';

// Montaje calcado del `beforeEach` de orders.service.spec.ts (es largo, pero
// una prueba que depende del montaje de otro fichero es peor). Cualquier
// cambio en cómo se ensambla OrdersService debe reflejarse en los dos sitios.

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
  } as Order;
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

describe('la tienda y el panel crean el mismo pedido', () => {
  let service: OrdersService;
  let dataSource: { transaction: jest.Mock };
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
    availableForArea: jest.Mock;
  };
  let clientRepo: { findOne: jest.Mock };
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
  let geographyService: {
    getMunicipalityOrThrow: jest.Mock;
    getProvinceOrThrow: jest.Mock;
  };

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
      availableForArea: jest.fn().mockResolvedValue(new Map()),
    };
    clientRepo = { findOne: jest.fn() };
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
    dataSource = {
      transaction: jest.fn((cb: (m: unknown) => unknown) => cb(manager)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrdersService,
        { provide: getRepositoryToken(Order), useValue: orderRepo },
        { provide: getRepositoryToken(Client), useValue: clientRepo },
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

  // El mismo pedido por las dos vías: dos unidades de prod-1 a 7,50, entrega
  // a domicilio sin recargo. Si los dos caminos divergen algún día en stock,
  // totales o plazo, esta prueba lo dice antes que un cliente.
  const mismasLineas = { productId: 'prod-1', quantity: 2, unitPrice: 7.5 };

  it('aparta el mismo stock, calcula el mismo total y congela el mismo plazo', async () => {
    // --- Vía 1: el checkout de la tienda ---
    cartService.getCart.mockResolvedValue({
      items: [cartLine],
      totalItems: 2,
      subtotal: 15,
    });
    orderRepo.findOne.mockResolvedValue(makeOrder({ items: [] }));

    await service.checkout(makeClient(), {});
    const porLaTienda = {
      reserva: inventoryService.reserve.mock.calls.at(-1),
      pedido: orderRepo.save.mock.calls.at(-1)?.[0],
    };

    jest.clearAllMocks();

    // --- Vía 2: el alta desde el panel ---
    // Mocks calcados de describe('crearParaCliente') en orders.service.spec.ts
    // (su beforeEach compartido), no reinventados aquí: `clientRepo.findOne`
    // ahora exige `isActive: true` porque crearParaCliente rechaza clientes
    // desactivados, y sin ese campo la prueba fallaría por un motivo que no
    // es el que se quiere medir.
    orderRepo.findOne.mockResolvedValue(makeOrder({ items: [] }));
    productsService.availableForArea = jest
      .fn()
      .mockResolvedValue(new Map([['prod-1', 10]]));
    clientRepo.findOne.mockResolvedValue({
      id: 'client-1',
      defaultMunicipalityId: 'mun-1',
      isActive: true,
    });

    await service.crearParaCliente(makeUser(Role.ADMIN), {
      clientId: 'client-1',
      items: [mismasLineas],
    });
    const porElPanel = {
      reserva: inventoryService.reserve.mock.calls.at(-1),
      pedido: orderRepo.save.mock.calls.at(-1)?.[0],
    };

    // Mismo producto, misma cantidad, mismos almacenes permitidos.
    expect(porElPanel.reserva?.slice(2)).toEqual(porLaTienda.reserva?.slice(2));
    // Mismo dinero y mismo compromiso de entrega.
    expect(porElPanel.pedido.subtotal).toBe(porLaTienda.pedido.subtotal);
    expect(porElPanel.pedido.total).toBe(porLaTienda.pedido.total);
    expect(porElPanel.pedido.promiseDays).toBe(porLaTienda.pedido.promiseDays);
    expect(porElPanel.pedido.fulfillmentType).toBe(
      porLaTienda.pedido.fulfillmentType,
    );
    // Y el mismo estado de salida: pendiente de pago.
    expect(porElPanel.pedido.status).toBe(porLaTienda.pedido.status);
    expect(porElPanel.pedido.paymentStatus).toBe(
      porLaTienda.pedido.paymentStatus,
    );
    // Deliberadamente FUERA de la comparación: `actor` en el evento de
    // creación (empleado vs. cliente) y el aviso por correo (uno abre el
    // carrito, el otro no lo toca). Esas son las diferencias legítimas entre
    // los dos caminos; compararlas también haría que la prueba fallara por
    // algo que no es un defecto.
  });
});
