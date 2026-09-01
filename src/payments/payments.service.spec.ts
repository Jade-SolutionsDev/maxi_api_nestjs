import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { InventoryService } from '../inventory/inventory.service';
import { OrderItem } from '../orders/entities/order-item.entity';
import {
  CancellationReason,
  Order,
  OrderStatus,
  PaymentStatus,
} from '../orders/entities/order.entity';
import { ChargeStatus, PaymentCharge } from './entities/payment-charge.entity';
import {
  GatewayCharge,
  GatewayWebhookEvent,
  PaymentGateway,
} from './payment-gateway.interface';
import { PaymentMethodsService } from './payment-methods.service';
import { PaymentsService } from './payments.service';

function makeOrder(overrides: Partial<Order> = {}): Order {
  return {
    id: 'order-1',
    orderNumber: 'ORD-20260001',
    clientId: 'client-1',
    paymentStatus: PaymentStatus.PENDING,
    paymentRef: null,
    total: '30.00',
    ...overrides,
  } as Order;
}

function makeCharge(overrides: Partial<PaymentCharge> = {}): PaymentCharge {
  return {
    id: 'charge-1',
    orderId: 'order-1',
    provider: 'fake',
    reference: 'REF123',
    idempotencyKey: 'order_ORD-20260001_fake_1',
    status: ChargeStatus.REQUIRES_ACTION,
    amount: '30.00',
    feeAmount: null,
    settlementAmount: null,
    currency: 'USD',
    actionPayload: null,
    redirectUrl: null,
    lastPayload: null,
    errorMessage: null,
    expiresAt: new Date(Date.now() + 300_000),
    completedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

// A gateway whose every call is a jest mock, so the tests exercise the
// provider-independent half only.
class FakeGateway extends PaymentGateway {
  readonly code = 'fake';
  readonly kind = 'redirect' as const;
  configuredValue = true;

  createCharge = jest.fn(
    (order: Order, key: string): Promise<GatewayCharge> =>
      Promise.resolve({
        reference: key,
        status: ChargeStatus.REQUIRES_ACTION,
        amount: order.total,
        currency: 'USD',
        redirectUrl: 'https://tppay.me/abc',
        rawPayload: {},
      }),
  );
  syncCharge = jest.fn(
    (charge: PaymentCharge): Promise<GatewayCharge> =>
      Promise.resolve({
        reference: charge.reference,
        status: charge.status,
        amount: charge.amount,
        currency: charge.currency,
        rawPayload: {},
      }),
  );
  parseWebhook = jest.fn(
    (): GatewayWebhookEvent => ({
      reference: 'REF123',
      charge: { status: ChargeStatus.SUCCEEDED, rawPayload: {} },
    }),
  );

  get configured(): boolean {
    return this.configuredValue;
  }
}

describe('PaymentsService', () => {
  let service: PaymentsService;
  let gateway: FakeGateway;
  let chargeRepo: {
    findOne: jest.Mock;
    count: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
  };
  let orderRepo: { findOne: jest.Mock; save: jest.Mock };
  let methods: { gatewayFor: jest.Mock; resolve: jest.Mock };
  let orderItemRepo: { find: jest.Mock };
  let inventory: { reserve: jest.Mock };

  beforeEach(async () => {
    gateway = new FakeGateway();
    chargeRepo = {
      findOne: jest.fn().mockResolvedValue(null),
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn().mockImplementation((c: unknown) => c),
      save: jest.fn().mockImplementation((c: unknown) => Promise.resolve(c)),
    };
    orderRepo = {
      findOne: jest.fn().mockResolvedValue(makeOrder()),
      save: jest.fn().mockImplementation((o: unknown) => Promise.resolve(o)),
    };
    methods = {
      gatewayFor: jest.fn().mockReturnValue(gateway),
      resolve: jest.fn().mockResolvedValue(gateway),
    };
    orderItemRepo = {
      find: jest.fn().mockResolvedValue([{ productId: 'prod-1', quantity: 2 }]),
    };
    inventory = { reserve: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentsService,
        { provide: getRepositoryToken(PaymentCharge), useValue: chargeRepo },
        { provide: getRepositoryToken(Order), useValue: orderRepo },
        { provide: getRepositoryToken(OrderItem), useValue: orderItemRepo },
        { provide: PaymentMethodsService, useValue: methods },
        { provide: InventoryService, useValue: inventory },
        {
          provide: DataSource,
          useValue: {
            transaction: jest.fn((cb: (m: unknown) => unknown) =>
              cb({ getRepository: () => orderRepo }),
            ),
          },
        },
      ],
    }).compile();

    service = module.get(PaymentsService);
  });

  describe('createChargeForOrder', () => {
    it('keys each attempt by provider and attempt number', async () => {
      chargeRepo.count.mockResolvedValue(2); // two prior attempts

      await service.createChargeForOrder(makeOrder(), gateway);

      expect(gateway.createCharge).toHaveBeenCalledWith(
        expect.anything(),
        'order_ORD-20260001_fake_3',
      );
    });

    it('reports an unreachable gateway as 502, not 500', async () => {
      gateway.createCharge.mockRejectedValue(new Error('ECONNREFUSED'));

      await expect(
        service.createChargeForOrder(makeOrder(), gateway),
      ).rejects.toBeInstanceOf(BadGatewayException);
    });

    it('keeps our own validation errors intact', async () => {
      gateway.createCharge.mockRejectedValue(
        new BadRequestException('Tropipay only settles in EUR or USD'),
      );

      await expect(
        service.createChargeForOrder(makeOrder(), gateway),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('stamps the provider on the charge and the reference on the order', async () => {
      await service.createChargeForOrder(makeOrder(), gateway);

      expect(chargeRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          orderId: 'order-1',
          provider: 'fake',
          redirectUrl: 'https://tppay.me/abc',
          status: ChargeStatus.REQUIRES_ACTION,
        }),
      );
      expect(orderRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          paymentRef: 'order_ORD-20260001_fake_1',
        }),
      );
    });
  });

  describe('syncCharge', () => {
    it('does not call the gateway for terminal charges', async () => {
      await service.syncCharge(makeCharge({ status: ChargeStatus.SUCCEEDED }));

      expect(gateway.syncCharge).not.toHaveBeenCalled();
    });

    it('marks the order paid ONLY on SUCCEEDED', async () => {
      gateway.syncCharge.mockResolvedValue({
        reference: 'REF123',
        status: ChargeStatus.SUCCEEDED,
        amount: '30.00',
        currency: 'USD',
        rawPayload: {},
      });

      await service.syncCharge(makeCharge());

      expect(orderRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ paymentStatus: PaymentStatus.PAID }),
      );
    });

    it('leaves the order pending on EXPIRED (retry stays possible)', async () => {
      gateway.syncCharge.mockResolvedValue({
        reference: 'REF123',
        status: ChargeStatus.EXPIRED,
        amount: '30.00',
        currency: 'USD',
        rawPayload: {},
      });

      await service.syncCharge(makeCharge());

      expect(orderRepo.save).not.toHaveBeenCalled();
    });

    it('never downgrades a paid order', async () => {
      orderRepo.findOne.mockResolvedValue(
        makeOrder({ paymentStatus: PaymentStatus.PAID }),
      );
      gateway.syncCharge.mockResolvedValue({
        reference: 'REF123',
        status: ChargeStatus.FAILED,
        amount: '30.00',
        currency: 'USD',
        rawPayload: {},
      });

      await service.syncCharge(makeCharge());

      expect(orderRepo.save).not.toHaveBeenCalled();
    });
  });

  describe('createChargeForClient', () => {
    it('rejects when the order is already paid', async () => {
      orderRepo.findOne.mockResolvedValue(
        makeOrder({ paymentStatus: PaymentStatus.PAID }),
      );

      await expect(
        service.createChargeForClient('client-1', 'order-1'),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(gateway.createCharge).not.toHaveBeenCalled();
    });

    it('returns the live attempt instead of stacking charges', async () => {
      chargeRepo.findOne.mockResolvedValue(makeCharge());

      const result = await service.createChargeForClient('client-1', 'order-1');

      expect(result.reference).toBe('REF123');
      expect(gateway.createCharge).not.toHaveBeenCalled();
      // Non-terminal → it was refreshed from the gateway first.
      expect(gateway.syncCharge).toHaveBeenCalled();
    });

    it('creates a new attempt after the previous one expired', async () => {
      chargeRepo.findOne.mockResolvedValue(
        makeCharge({ status: ChargeStatus.EXPIRED }),
      );
      chargeRepo.count.mockResolvedValue(1);

      await service.createChargeForClient('client-1', 'order-1');

      expect(gateway.createCharge).toHaveBeenCalledWith(
        expect.anything(),
        'order_ORD-20260001_fake_2',
      );
    });

    it('starts a fresh attempt when the customer switches method', async () => {
      // A live charge exists, but it belongs to another gateway.
      chargeRepo.findOne.mockResolvedValue(makeCharge({ provider: 'other' }));

      await service.createChargeForClient('client-1', 'order-1', 'fake');

      expect(gateway.syncCharge).not.toHaveBeenCalled();
      expect(gateway.createCharge).toHaveBeenCalled();
    });
  });

  describe('handleWebhook', () => {
    it('applies a verified terminal event and pays the order', async () => {
      chargeRepo.findOne.mockResolvedValue(makeCharge());

      const result = await service.handleWebhook('fake', '{}', {});

      expect(result).toEqual({ processed: true });
      expect(chargeRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ status: ChargeStatus.SUCCEEDED }),
      );
      expect(orderRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ paymentStatus: PaymentStatus.PAID }),
      );
    });

    it('stamps completedAt on a terminal event', async () => {
      chargeRepo.findOne.mockResolvedValue(makeCharge());

      await service.handleWebhook('fake', '{}', {});

      expect(chargeRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ completedAt: expect.any(Date) }),
      );
    });

    it('is idempotent for re-delivered terminal events', async () => {
      chargeRepo.findOne.mockResolvedValue(
        makeCharge({ status: ChargeStatus.SUCCEEDED }),
      );

      const result = await service.handleWebhook('fake', '{}', {});

      expect(result).toEqual({ processed: true });
      expect(chargeRepo.save).not.toHaveBeenCalled();
      expect(orderRepo.save).not.toHaveBeenCalled();
    });

    it('tolerates unknown references without failing', async () => {
      chargeRepo.findOne.mockResolvedValue(null);

      expect(await service.handleWebhook('fake', '{}', {})).toEqual({
        processed: false,
      });
    });

    it('tolerates an event with no reference at all (never a 500)', async () => {
      gateway.parseWebhook.mockReturnValue({
        reference: undefined as unknown as string,
        charge: { status: ChargeStatus.SUCCEEDED, rawPayload: {} },
      });

      expect(await service.handleWebhook('fake', '{}', {})).toEqual({
        processed: false,
      });
      expect(chargeRepo.findOne).not.toHaveBeenCalled();
    });

    it('does not blank fields the event omitted', async () => {
      chargeRepo.findOne.mockResolvedValue(
        makeCharge({ redirectUrl: 'https://tppay.me/abc' }),
      );

      await service.handleWebhook('fake', '{}', {});

      expect(chargeRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ redirectUrl: 'https://tppay.me/abc' }),
      );
    });
  });

  describe('payment arriving after the order expired', () => {
    const expiredOrder = () =>
      makeOrder({
        status: OrderStatus.CANCELLED,
        cancellationReason: CancellationReason.PAYMENT_NOT_RECEIVED,
      });

    const succeed = () => {
      gateway.parseWebhook.mockReturnValue({
        reference: 'REF123',
        charge: { status: ChargeStatus.SUCCEEDED, rawPayload: {} },
      });
      chargeRepo.findOne.mockResolvedValue(makeCharge());
    };

    it('reinstates the order when the stock is still there', async () => {
      orderRepo.findOne.mockResolvedValue(expiredOrder());
      succeed();

      await service.handleWebhook('fake', '{}', {});

      expect(inventory.reserve).toHaveBeenCalledWith(
        expect.anything(),
        'order-1',
        'prod-1',
        2,
      );
      expect(orderRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          status: OrderStatus.PENDING,
          paymentStatus: PaymentStatus.PAID,
          cancellationReason: null,
        }),
      );
    });

    it('flags it for refund when the stock is gone', async () => {
      orderRepo.findOne.mockResolvedValue(expiredOrder());
      inventory.reserve.mockRejectedValue(new ConflictException('no stock'));
      succeed();

      await service.handleWebhook('fake', '{}', {});

      expect(orderRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          status: OrderStatus.CANCELLED,
          paymentStatus: PaymentStatus.PAID,
          cancellationReason: CancellationReason.PAID_AFTER_EXPIRY_OUT_OF_STOCK,
        }),
      );
    });

    it('leaves an order cancelled for any other reason alone', async () => {
      orderRepo.findOne.mockResolvedValue(
        makeOrder({ status: OrderStatus.CANCELLED, cancellationReason: null }),
      );
      succeed();

      await service.handleWebhook('fake', '{}', {});

      expect(inventory.reserve).not.toHaveBeenCalled();
    });

    it('does not re-reserve for an ordinary payment on a live order', async () => {
      succeed();

      await service.handleWebhook('fake', '{}', {});

      expect(inventory.reserve).not.toHaveBeenCalled();
    });
  });

  // Mi Billetera registers ONE notification URL, so a charge created by the
  // wallet option is announced on the crypto option's route. Resolving by
  // provider as well as reference used to lose it, and the payment never
  // confirmed.
  describe('a callback arriving on a sibling gateway route', () => {
    it('settles a charge stored under another provider', async () => {
      chargeRepo.findOne.mockResolvedValue(
        makeCharge({ provider: 'mibilletera-wallet' }),
      );
      gateway.parseWebhook.mockReturnValue({
        reference: 'REF123',
        charge: { status: ChargeStatus.SUCCEEDED, rawPayload: {} },
      });

      const result = await service.handleWebhook('mibilletera', '{}', {});

      expect(result).toEqual({ processed: true });
      expect(orderRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ paymentStatus: PaymentStatus.PAID }),
      );
    });

    it('looks the charge up by reference alone', async () => {
      chargeRepo.findOne.mockResolvedValue(makeCharge());

      await service.handleWebhook('mibilletera', '{}', {});

      expect(chargeRepo.findOne).toHaveBeenCalledWith({
        where: { reference: 'REF123' },
      });
    });
  });
});
