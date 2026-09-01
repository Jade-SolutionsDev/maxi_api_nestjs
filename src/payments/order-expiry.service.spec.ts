import { ReservationStatus } from '../inventory/entities/inventory-reservation.entity';
import { ConflictException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import {
  CancellationReason,
  Order,
  OrderStatus,
  PaymentStatus,
} from '../orders/entities/order.entity';
import { InventoryService } from '../inventory/inventory.service';
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
  let service: OrderExpiryService;
  let orderRepo: { find: jest.Mock; findOne: jest.Mock; save: jest.Mock };
  let payments: { latestChargesFor: jest.Mock };
  let methods: { gatewayFor: jest.Mock };
  let inventory: { releaseReservations: jest.Mock };
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

    const manager = { getRepository: () => orderRepo };
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

  // Initiation failed, so there is no attempt to measure from; the order's own
  // age gets the forgiving window.
  it('falls back to the manual window when the order has no attempt', async () => {
    await sweepWith(makeOrder({ createdAt: ago(2 * HOUR) }));

    expect(saved).toHaveLength(0);

    await sweepWith(makeOrder({ createdAt: ago(25 * HOUR) }));

    expect(saved[0]).toMatchObject({ status: OrderStatus.CANCELLED });
  });

  // The race the whole design exists to avoid.
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
});
