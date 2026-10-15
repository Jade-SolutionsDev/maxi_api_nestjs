import { ReservationStatus } from '../inventory/entities/inventory-reservation.entity';
import { ConflictException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { CartItem } from '../cart/entities/cart-item.entity';
import { DataSource } from 'typeorm';
import {
  CancellationReason,
  Order,
  OrderStatus,
  PaymentStatus,
} from '../orders/entities/order.entity';
import { InventoryService } from '../inventory/inventory.service';
import { OrderEventsService } from '../order-events/order-events.service';
import { OrderMailerService } from '../mail/order-mailer.service';
import { ChargeStatus, PaymentCharge } from './entities/payment-charge.entity';
import { OrderExpiryService } from './order-expiry.service';
import { PaymentMethodsService } from './payment-methods.service';
import { PaymentsService } from './payments.service';

const MINUTE = 60_000;
const HOUR = 3_600_000;

const ago = (ms: number) => new Date(Date.now() - ms);

const makeOrder = (overrides: Partial<Order> = {}): Order =>
  ({
    id: 'order-1',
    orderNumber: 'ORD-20260001',
    status: OrderStatus.PENDING,
    paymentStatus: PaymentStatus.PENDING,
    cancellationReason: null,
    createdAt: ago(2 * HOUR),
    ...overrides,
  }) as Order;

const makeCharge = (overrides: Partial<PaymentCharge> = {}): PaymentCharge =>
  ({
    orderId: 'order-1',
    provider: 'tropipay',
    status: ChargeStatus.REQUIRES_ACTION,
    createdAt: ago(2 * HOUR),
    ...overrides,
  }) as PaymentCharge;

describe('OrderExpiryService', () => {
  const mailer = { cancelled: jest.fn().mockResolvedValue(null) };
  let service: OrderExpiryService;
  let orderRepo: { find: jest.Mock; findOne: jest.Mock; save: jest.Mock };
  let payments: { latestChargesFor: jest.Mock };
  let methods: { gatewayFor: jest.Mock };
  let inventory: { releaseReservations: jest.Mock };
  let cartRepo: {
    find: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    remove: jest.Mock;
  };
  let saved: Order[];

  beforeEach(async () => {
    saved = [];
    orderRepo = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn(),
      save: jest.fn().mockImplementation((o: Order) => {
        saved.push(o);
        return Promise.resolve(o);
      }),
    };
    payments = { latestChargesFor: jest.fn().mockResolvedValue(new Map()) };
    methods = {
      gatewayFor: jest.fn((code: string) => ({
        code,
        kind: code === 'manual' ? 'manual' : 'redirect',
      })),
    };
    inventory = { releaseReservations: jest.fn() };

    cartRepo = {
      find: jest.fn().mockResolvedValue([]),
      create: jest.fn((datos: unknown) => datos),
      save: jest.fn((filas: unknown) => Promise.resolve(filas)),
      remove: jest.fn((filas: unknown) => Promise.resolve(filas)),
    };
    // Por entidad, no uno para todo: devolviendo `orderRepo` a cualquiera,
    // `getRepository(CartItem)` daba pedidos y nada de lo del carrito se medía.
    const manager = {
      getRepository: (entity: unknown) =>
        entity === CartItem ? cartRepo : orderRepo,
    };
    const dataSource = {
      transaction: jest.fn((cb: (m: unknown) => unknown) => cb(manager)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrderExpiryService,
        { provide: getRepositoryToken(Order), useValue: orderRepo },
        { provide: PaymentsService, useValue: payments },
        { provide: PaymentMethodsService, useValue: methods },
        { provide: InventoryService, useValue: inventory },
        {
          provide: OrderEventsService,
          useValue: { record: jest.fn().mockResolvedValue(undefined) },
        },
        {
          provide: OrderMailerService,
          useValue: mailer,
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn(() => ({
              expiry: { gatewayMinutes: 30, manualHours: 24 },
            })),
          },
        },
        { provide: DataSource, useValue: dataSource },
      ],
    }).compile();

    service = module.get(OrderExpiryService);
  });

  const sweepWith = async (order: Order, charge?: PaymentCharge) => {
    orderRepo.find.mockResolvedValue([order]);
    orderRepo.findOne.mockResolvedValue(order);
    payments.latestChargesFor.mockResolvedValue(
      charge ? new Map([[order.id, charge]]) : new Map(),
    );
    return service.sweep();
  };

  it('cancels an expired gateway order and releases its hold', async () => {
    const order = makeOrder();
    const result = await sweepWith(
      order,
      makeCharge({ createdAt: ago(31 * MINUTE) }),
    );

    expect(inventory.releaseReservations).toHaveBeenCalledWith(
      expect.anything(),
      'order-1',
      undefined,
      // Caducada, no cancelada: es lo que permite medirlas por separado.
      ReservationStatus.EXPIRED,
    );
    expect(saved[0]).toMatchObject({
      status: OrderStatus.CANCELLED,
      cancellationReason: CancellationReason.PAYMENT_NOT_RECEIVED,
    });
    expect(result).toMatchObject({
      scanned: 1,
      cancelled: 1,
      orderIds: ['order-1'],
    });
  });

  /**
   * MxH-0099. El carrito se vacía al crear el pedido, y hasta ahora caducar lo
   * dejaba vacío para siempre: el cliente apartaba quince líneas, no llegaba a
   * pagar y tenía que armar la compra otra vez desde el catálogo. El correo de
   * caducidad llegaba a decirle «puedes hacer el pedido otra vez».
   */
  it('devuelve al carrito del cliente lo que el pedido caducado se llevó', async () => {
    const order = makeOrder({
      clientId: 'client-1',
      items: [
        { productId: 'ibc-diesel', quantity: 2 },
        { productId: 'panel-solar', quantity: 1 },
      ],
    } as Partial<Order>);

    await sweepWith(order, makeCharge({ createdAt: ago(31 * MINUTE) }));

    expect(cartRepo.save).toHaveBeenCalledWith([
      { clientId: 'client-1', productId: 'ibc-diesel', quantity: 2 },
      { clientId: 'client-1', productId: 'panel-solar', quantity: 1 },
    ]);
  });

  it('no toca el carrito de un pedido que todavía no caduca', async () => {
    const order = makeOrder({
      clientId: 'client-1',
      items: [{ productId: 'ibc-diesel', quantity: 2 }],
    } as Partial<Order>);

    await sweepWith(order, makeCharge({ createdAt: ago(5 * MINUTE) }));

    expect(cartRepo.save).not.toHaveBeenCalled();
  });

  it('spares a gateway order still inside its window', async () => {
    await sweepWith(makeOrder(), makeCharge({ createdAt: ago(20 * MINUTE) }));

    expect(inventory.releaseReservations).not.toHaveBeenCalled();
    expect(saved).toHaveLength(0);
  });

  // The window runs from the last attempt, so retrying earns a fresh one.
  it('measures from the newest attempt, not from order creation', async () => {
    const order = makeOrder({ createdAt: ago(5 * HOUR) });
    await sweepWith(order, makeCharge({ createdAt: ago(5 * MINUTE) }));

    expect(saved).toHaveLength(0);
  });

  it('gives a manual order the long window', async () => {
    const order = makeOrder();
    await sweepWith(
      order,
      makeCharge({ provider: 'manual', createdAt: ago(2 * HOUR) }),
    );

    expect(saved).toHaveLength(0);

    await sweepWith(
      order,
      makeCharge({ provider: 'manual', createdAt: ago(25 * HOUR) }),
    );

    expect(saved[0]).toMatchObject({ status: OrderStatus.CANCELLED });
  });

  it('never expires cash, identified by the payment-attempt snapshot', async () => {
    const order = makeOrder({ createdAt: ago(7 * 24 * HOUR) });
    await sweepWith(
      order,
      makeCharge({
        // Deliberately not called "cash": names and codes are editable content.
        provider: 'pago-en-el-local',
        createdAt: ago(7 * 24 * HOUR),
        actionPayload: {
          instructions: { type: 'cash', note: 'Paga en Cárdenas' },
        },
      }),
    );

    expect(inventory.releaseReservations).not.toHaveBeenCalled();
    expect(saved).toHaveLength(0);
  });

  // Initiation failed, so there is no attempt to measure from; the order's own
  // age gets the forgiving window.
  it('falls back to the manual window when the order has no attempt', async () => {
    await sweepWith(makeOrder({ createdAt: ago(2 * HOUR) }));

    expect(saved).toHaveLength(0);

    await sweepWith(makeOrder({ createdAt: ago(25 * HOUR) }));

    expect(saved[0]).toMatchObject({ status: OrderStatus.CANCELLED });
  });

  // The race the whole design exists to avoid.
  it('measures from the reinstatement when an admin brought the order back', async () => {
    // Twelve days old, no payment attempt, reinstated two hours ago: the
    // manual window (24h) counts from the reinstatement, not from creation.
    await sweepWith(
      makeOrder({
        createdAt: ago(12 * 24 * HOUR),
        reinstatedAt: ago(2 * HOUR),
      }),
    );
    expect(inventory.releaseReservations).not.toHaveBeenCalled();

    await sweepWith(
      makeOrder({
        createdAt: ago(12 * 24 * HOUR),
        reinstatedAt: ago(25 * HOUR),
      }),
    );
    expect(inventory.releaseReservations).toHaveBeenCalledTimes(1);
  });

  it('never cancels while money is in flight at the gateway', async () => {
    await sweepWith(
      makeOrder(),
      makeCharge({ status: ChargeStatus.PROCESSING, createdAt: ago(3 * HOUR) }),
    );

    expect(inventory.releaseReservations).not.toHaveBeenCalled();
    expect(saved).toHaveLength(0);
  });

  it('skips an order paid between the scan and the transaction', async () => {
    const order = makeOrder();
    orderRepo.find.mockResolvedValue([order]);
    payments.latestChargesFor.mockResolvedValue(
      new Map([[order.id, makeCharge({ createdAt: ago(3 * HOUR) })]]),
    );
    orderRepo.findOne.mockResolvedValue(
      makeOrder({ paymentStatus: PaymentStatus.PAID }),
    );

    const result = await service.sweep();

    expect(inventory.releaseReservations).not.toHaveBeenCalled();
    expect(result).toMatchObject({ scanned: 1, cancelled: 0 });
  });

  it('reports only the orders it actually cancelled', async () => {
    const order = makeOrder();
    orderRepo.find.mockResolvedValue([order]);
    orderRepo.findOne.mockResolvedValue(order);
    payments.latestChargesFor.mockResolvedValue(
      new Map([[order.id, makeCharge({ createdAt: ago(3 * HOUR) })]]),
    );
    inventory.releaseReservations.mockRejectedValue(
      new ConflictException('locked'),
    );

    const result = await service.sweep();

    expect(result).toMatchObject({ scanned: 1, cancelled: 0, orderIds: [] });
  });

  it('asks the database only for orders past the shortest window', async () => {
    await service.sweep();

    const where = orderRepo.find.mock.calls[0][0].where;
    expect(where.status).toBe(OrderStatus.PENDING);
    expect(where.createdAt).toBeDefined();
    expect(payments.latestChargesFor).not.toHaveBeenCalled();
  });
  // `void` sin `.catch()` deja una promesa sin dueño, y en Node eso tumba el
  // proceso. Se comprueba de dos maneras porque una sola engaña: que el correo
  // se haya intentado —si no, la prueba no toca el camino— y que el rechazo no
  // se propague al barrido.
  it('un correo que revienta no tumba el barrido', async () => {
    mailer.cancelled.mockRejectedValueOnce(new Error('resend caído'));
    const order = makeOrder();

    const result = await sweepWith(
      order,
      makeCharge({ createdAt: ago(31 * MINUTE) }),
    );

    expect(mailer.cancelled).toHaveBeenCalledWith(
      order.id,
      CancellationReason.PAYMENT_NOT_RECEIVED,
    );
    expect(result.cancelled).toBe(1);
  });
});
