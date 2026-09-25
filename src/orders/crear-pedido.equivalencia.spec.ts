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

// `prod-2` a propósito, no `prod-1`: es lo que devuelve el fixture de
// `productsService.findOne` en el `beforeEach`. Si la línea pidiera `prod-1`,
// el panel llamaría a `findOne('prod-1')` y el mock le devolvería igual un
// producto con `id: 'prod-2'` — un catálogo que se contradice a sí mismo.
// Inocuo mientras nadie compare las líneas del pedido, pero confuso para
// quien lo haga.
const cartLine = {
  productId: 'prod-2',
  name: 'Malta 355ml',
  slug: 'malta-355ml',
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

  // El mismo pedido por las dos vías: dos unidades de prod-2 a 7,50, entrega
  // a domicilio sin recargo. Si los dos caminos divergen algún día en stock,
  // totales o plazo, esta prueba lo dice antes que un cliente.
  const mismasLineas = { productId: 'prod-2', quantity: 2, unitPrice: 7.5 };

  // Plazo y tarifa NO triviales a propósito: con `promiseDays: undefined` (el
  // valor por defecto del mock) o `fee: '0.00'`, comparar esos campos entre
  // los dos caminos es una tautología — los dos leen el mismo mock y los dos
  // guardan lo mismo aunque `crearPedido` dejara de persistirlos. Con un
  // valor real, la comparación deja de ser gratis.
  function fulfillmentNoTrivial() {
    return {
      type: 'delivery',
      fee: '2.50',
      deliveryOptionId: null,
      deliveryOptionLabel: null,
      pickupLocationId: null,
      pickupAddressId: null,
      pickupAddressSnapshot: null,
      promiseDays: 3,
    };
  }

  it('aparta el mismo stock, calcula el mismo total y congela el mismo plazo', async () => {
    fulfillmentService.resolveChoice.mockResolvedValue(fulfillmentNoTrivial());

    // --- Vía 1: el checkout de la tienda ---
    cartService.getCart.mockResolvedValue({
      items: [cartLine],
      totalItems: 2,
      subtotal: 15,
    });
    orderRepo.findOne.mockResolvedValue(makeOrder({ items: [] }));

    await service.checkout(makeClient(), {});
    const porLaTienda = {
      // TODAS las reservas, no solo la última: con una sola línea da igual,
      // pero si un día uno de los dos caminos aparta stock de más (o de
      // menos) líneas que el otro, comparar solo `.at(-1)` no lo vería.
      reservas: inventoryService.reserve.mock.calls.map((c: unknown[]) =>
        c.slice(2),
      ),
      pedido: orderRepo.save.mock.calls.at(-1)?.[0],
      // Lo que cada camino le pide a los resolutores COMPARTIDOS, antes de
      // llegar a crearPedido(). crearPedido() es la misma función para los
      // dos, así que comparar solo su salida con entradas que la prueba ya
      // igualó a mano es casi una tautología: lo que de verdad puede
      // divergir es cómo cada llamador resuelve el municipio y la zona de
      // cobertura ANTES de llamarlo (ej.: checkout cae a
      // `client.defaultMunicipalityId`, crearParaCliente también — pero si
      // uno de los dos dejara de hacerlo, esto lo detecta aunque
      // crearPedido() nunca se entere).
      cobertura: productsService.coveringLocationIds.mock.calls.at(-1),
      resolucionDeEntrega: fulfillmentService.resolveChoice.mock.calls.at(-1),
    };

    // Ancla ABSOLUTA, no relativa: una prueba de equivalencia compara los dos
    // caminos ENTRE SÍ, nunca contra la verdad. Como los dos comparten
    // crearPedido(), si `orders.service.ts` dejara de persistir `promiseDays`
    // (o lo persistiera mal), las dos vías degradarían igual —las dos
    // valdrían `undefined`, o las dos el mismo valor equivocado— y todas las
    // comparaciones de abajo seguirían en verde. `toEqual` tampoco lo vería:
    // ignora las claves que faltan en los dos objetos por igual. Sin este
    // ancla, y sin ninguna otra prueba del repo que verifique que crear un
    // pedido persiste el plazo, ese defecto no lo detectaría nadie.
    expect(porLaTienda.pedido.promiseDays).toBe(3);
    expect(porLaTienda.pedido.total).toBe('17.50');

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
      .mockResolvedValue(new Map([['prod-2', 10]]));
    clientRepo.findOne.mockResolvedValue({
      id: 'client-1',
      defaultMunicipalityId: 'mun-1',
      isActive: true,
    });
    // `jest.clearAllMocks()` limpia las llamadas registradas pero no borra
    // `mockResolvedValue` (eso lo haría `mockReset`), así que
    // `resolveChoice` sigue devolviendo `fulfillmentNoTrivial()` aquí sin
    // volver a fijarlo.

    await service.crearParaCliente(makeUser(Role.ADMIN), {
      clientId: 'client-1',
      items: [mismasLineas],
    });
    const porElPanel = {
      reservas: inventoryService.reserve.mock.calls.map((c: unknown[]) =>
        c.slice(2),
      ),
      pedido: orderRepo.save.mock.calls.at(-1)?.[0],
      cobertura: productsService.coveringLocationIds.mock.calls.at(-1),
      resolucionDeEntrega: fulfillmentService.resolveChoice.mock.calls.at(-1),
    };

    // Mismos productos, mismas cantidades, mismos almacenes permitidos —
    // línea por línea, no solo la última.
    expect(porElPanel.reservas).toEqual(porLaTienda.reservas);
    // Mismo municipio y misma zona de cobertura resueltos ANTES de crear el
    // pedido: si uno de los dos caminos dejara de resolverlos igual, esto
    // falla aunque crearPedido() sea idéntico para los dos.
    expect(porElPanel.cobertura).toEqual(porLaTienda.cobertura);
    expect(porElPanel.resolucionDeEntrega).toEqual(
      porLaTienda.resolucionDeEntrega,
    );

    // El pedido ENTERO, no seis campos elegidos a dedo: un campo nuevo que
    // alguien añada a Order queda cubierto solo, sin que nadie tenga que
    // acordarse de sumarlo aquí.
    //
    // Lo único que se excluye, y por qué:
    // - `trackingId`: 32 bytes aleatorios que `crearPedido` genera de
    //   nuevo en cada pedido (randomBytes). Dos pedidos "iguales" nunca
    //   pueden compartirlo; comparar el valor real compararía aleatoriedad,
    //   no diseño.
    expect({ ...porElPanel.pedido, trackingId: null }).toEqual({
      ...porLaTienda.pedido,
      trackingId: null,
    });

    // Las mismas aserciones concretas de antes, ADEMÁS de la comparación
    // completa: si algo se rompe, dicen exactamente qué campo fue, en vez de
    // forzar a leer un diff de objeto entero.
    expect(porElPanel.pedido.subtotal).toBe(porLaTienda.pedido.subtotal);
    expect(porElPanel.pedido.total).toBe(porLaTienda.pedido.total);
    expect(porElPanel.pedido.promiseDays).toBe(porLaTienda.pedido.promiseDays);
    expect(porElPanel.pedido.fulfillmentType).toBe(
      porLaTienda.pedido.fulfillmentType,
    );
    expect(porElPanel.pedido.status).toBe(porLaTienda.pedido.status);
    expect(porElPanel.pedido.paymentStatus).toBe(
      porLaTienda.pedido.paymentStatus,
    );

    // Deliberadamente FUERA de la comparación —ni en el objeto entero (no
    // forman parte de la fila de `orders`) ni en aserciones aparte—: el
    // `actor` del evento de creación (empleado vs. cliente) y el aviso por
    // correo / vaciado de carrito (uno abre el carrito, el otro no lo toca).
    // Esas son las diferencias legítimas entre los dos caminos; compararlas
    // haría que la prueba fallara por algo que no es un defecto.
  });

  it('sin unitPrice pactado, el panel calcula el precio con la fórmula entera del catálogo', async () => {
    // OJO con lo que esta prueba compara y lo que no: el lado "tienda" sigue
    // siendo el mismo mock de siempre — `cartLine.unitPrice: 7.5` es un
    // número que puse yo, no algo que calcule ninguna fórmula del carrito.
    // Esta prueba NO compara "la fórmula del carrito" contra "la fórmula del
    // panel"; compara la fórmula que SÍ corre de verdad en resolveLines()
    // (basePrice con su descuento, cuando el panel no manda `unitPrice`)
    // contra un número puesto a mano que sabemos que tiene que dar 7,50. La
    // línea de `mismasLineas`, que sí manda `unitPrice: 7.5`, cortocircuita
    // esa fórmula y por eso no sirve para esto.
    cartService.getCart.mockResolvedValue({
      items: [cartLine],
      totalItems: 2,
      subtotal: 15,
    });
    orderRepo.findOne.mockResolvedValue(makeOrder({ items: [] }));

    await service.checkout(makeClient(), {});
    const porLaTienda = {
      pedido: orderRepo.save.mock.calls.at(-1)?.[0],
    };

    jest.clearAllMocks();

    orderRepo.findOne.mockResolvedValue(makeOrder({ items: [] }));
    productsService.availableForArea = jest
      .fn()
      .mockResolvedValue(new Map([['prod-2', 10]]));
    // basePrice y discount elegidos para que el TÉRMINO DEL DESCUENTO no
    // valga 1: con `discount: '0'`, `1 - discount/100` da 1 y la prueba
    // seguiría en verde aunque alguien borrara ese término de
    // `resolveLines()`. Con 10,00 al 25% sí se ejercita la fórmula completa,
    // y el resultado (7,50) es el mismo que cartLine para poder comparar.
    productsService.findOne = jest.fn().mockResolvedValue({
      id: 'prod-2',
      name: 'Malta 355ml',
      basePrice: '10.00',
      discount: '25',
      isActive: true,
      deletedAt: null,
    });
    clientRepo.findOne.mockResolvedValue({
      id: 'client-1',
      defaultMunicipalityId: 'mun-1',
      isActive: true,
    });

    await service.crearParaCliente(makeUser(Role.ADMIN), {
      clientId: 'client-1',
      items: [{ productId: 'prod-2', quantity: 2 }], // sin unitPrice
    });
    const porElPanel = {
      pedido: orderRepo.save.mock.calls.at(-1)?.[0],
    };

    expect(porElPanel.pedido.subtotal).toBe(porLaTienda.pedido.subtotal);
    expect(porElPanel.pedido.total).toBe(porLaTienda.pedido.total);
  });

  it('el destinatario sale de la dirección igual en los dos caminos, aunque falte el carné', async () => {
    // El caso que motiva la tarea: entrega a domicilio, sin `contact`
    // explícito, y la dirección sin carné (CreateClientAddressDto.idCard es
    // opcional, igual que en el panel). La tienda nunca lo exige aquí; si el
    // panel divergiera y lo exigiera, esta prueba lo diría antes que un
    // empleado atascado en el formulario.
    const direccionSinCarne = {
      street: 'Calle 23 #456',
      municipalityId: 'mun-1',
      recipientName: 'Ana Pérez',
      contactPhone: '55512345',
    };

    // --- Vía 1: el checkout de la tienda ---
    cartService.getCart.mockResolvedValue({
      items: [cartLine],
      totalItems: 2,
      subtotal: 15,
    });
    orderRepo.findOne.mockResolvedValue(makeOrder({ items: [] }));

    await service.checkout(makeClient(), { address: direccionSinCarne });
    const porLaTienda = {
      pedido: orderRepo.save.mock.calls.at(-1)?.[0],
    };

    jest.clearAllMocks();

    // --- Vía 2: el alta desde el panel ---
    orderRepo.findOne.mockResolvedValue(makeOrder({ items: [] }));
    productsService.availableForArea = jest
      .fn()
      .mockResolvedValue(new Map([['prod-2', 10]]));
    clientRepo.findOne.mockResolvedValue({
      id: 'client-1',
      defaultMunicipalityId: 'mun-1',
      isActive: true,
    });

    await service.crearParaCliente(makeUser(Role.ADMIN), {
      clientId: 'client-1',
      items: [mismasLineas],
      deliveryAddress: direccionSinCarne,
    });
    const porElPanel = {
      pedido: orderRepo.save.mock.calls.at(-1)?.[0],
    };

    expect(porElPanel.pedido.contactSnapshot).toEqual(
      porLaTienda.pedido.contactSnapshot,
    );
    // Ancla ABSOLUTA, no solo relativa entre los dos caminos: sin esto, los
    // dos podrían coincidir en `undefined` (o en cualquier otro valor
    // equivocado) y la comparación de arriba seguiría en verde igual.
    expect(porElPanel.pedido.contactSnapshot).toEqual({
      recipientName: 'Ana Pérez',
      idCard: null,
      contactPhone: '55512345',
    });
  });
});
