import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { createHmac } from 'node:crypto';
import { Order, PaymentStatus } from '../entities/order.entity';
import { ChargeStatus, PaymentCharge } from './entities/payment-charge.entity';
import { MibiClient } from './mibi-client';
import { MibiPaymentService } from './mibi-payment.service';

const SECRET = 'whsec_test';

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
    reference: 'MCH123',
    idempotencyKey: 'order_ORD-20260001_crypto_1',
    status: ChargeStatus.REQUIRES_ACTION,
    amount: '30.00000000',
    feeAmount: null,
    settlementAmount: null,
    currency: 'USD',
    actionPayload: { deposit_address: '0xabc', token: 'usdt' },
    lastPayload: null,
    errorMessage: null,
    expiresAt: new Date(Date.now() + 300_000),
    completedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

const gatewayData = (overrides: Record<string, unknown> = {}) => ({
  charge_id: 'uuid-1',
  reference: 'MCH123',
  method: 'CRYPTO',
  amount: '30.00000000',
  fee_amount: '0.75000000',
  net_amount: '29.25000000',
  currency: 'USD',
  status: 'REQUIRES_ACTION',
  action_payload: {
    deposit_address: '0xabc',
    amount: '30.00000000',
    token: 'usdt',
    blockchain: 'BEP20',
  },
  expires_at: new Date(Date.now() + 300_000).toISOString(),
  completed_at: null,
  ...overrides,
});

describe('MibiPaymentService', () => {
  let service: MibiPaymentService;
  let chargeRepo: {
    findOne: jest.Mock;
    count: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
  };
  let orderRepo: { findOne: jest.Mock; save: jest.Mock };
  let client: { createCharge: jest.Mock; getCharge: jest.Mock };
  let config: { get: jest.Mock };

  beforeEach(async () => {
    chargeRepo = {
      findOne: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn().mockImplementation((c: unknown) => c),
      save: jest.fn().mockImplementation((c: unknown) => Promise.resolve(c)),
    };
    orderRepo = {
      findOne: jest.fn().mockResolvedValue(makeOrder()),
      save: jest.fn().mockImplementation((o: unknown) => Promise.resolve(o)),
    };
    client = {
      createCharge: jest.fn().mockResolvedValue(gatewayData()),
      getCharge: jest.fn().mockResolvedValue(gatewayData()),
    };
    config = {
      get: jest.fn((key: string) => {
        if (key === 'mibi') return { webhookSecret: SECRET, currency: 'USDT' };
        if (key === 'nodeEnv') return 'test';
        return undefined;
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MibiPaymentService,
        { provide: getRepositoryToken(PaymentCharge), useValue: chargeRepo },
        { provide: getRepositoryToken(Order), useValue: orderRepo },
        { provide: MibiClient, useValue: client },
        { provide: ConfigService, useValue: config },
      ],
    }).compile();

    service = module.get(MibiPaymentService);
  });

  describe('createChargeForOrder', () => {
    it('creates a CRYPTO charge with an attempt-scoped idempotency key', async () => {
      chargeRepo.count.mockResolvedValue(2); // two prior attempts

      await service.createChargeForOrder(makeOrder());

      expect(client.createCharge).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'CRYPTO',
          amount: '30.00',
          currency: 'USDT',
          idempotency_key: 'order_ORD-20260001_crypto_3',
          metadata: { order_id: 'order-1' },
        }),
      );
    });

    it('falls back to USD when no settlement currency is configured', async () => {
      config.get.mockImplementation((key: string) =>
        key === 'mibi' ? { webhookSecret: SECRET } : undefined,
      );

      await service.createChargeForOrder(makeOrder());

      expect(client.createCharge).toHaveBeenCalledWith(
        expect.objectContaining({ currency: 'USD' }),
      );
    });

    it('persists the charge and stores the reference on the order', async () => {
      await service.createChargeForOrder(makeOrder());

      expect(chargeRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          orderId: 'order-1',
          reference: 'MCH123',
          status: ChargeStatus.REQUIRES_ACTION,
        }),
      );
      expect(orderRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ paymentRef: 'MCH123' }),
      );
    });
  });

  describe('syncCharge', () => {
    it('does not call the gateway for terminal charges', async () => {
      const charge = makeCharge({ status: ChargeStatus.SUCCEEDED });

      await service.syncCharge(charge);

      expect(client.getCharge).not.toHaveBeenCalled();
    });

    it('marks the order paid ONLY on SUCCEEDED', async () => {
      client.getCharge.mockResolvedValue(
        gatewayData({
          status: 'SUCCEEDED',
          completed_at: new Date().toISOString(),
        }),
      );

      await service.syncCharge(makeCharge());

      expect(orderRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ paymentStatus: PaymentStatus.PAID }),
      );
    });

    it('marks the order failed on FAILED', async () => {
      client.getCharge.mockResolvedValue(gatewayData({ status: 'FAILED' }));

      await service.syncCharge(makeCharge());

      expect(orderRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ paymentStatus: PaymentStatus.FAILED }),
      );
    });

    it('leaves the order pending on EXPIRED (retry stays possible)', async () => {
      client.getCharge.mockResolvedValue(gatewayData({ status: 'EXPIRED' }));

      await service.syncCharge(makeCharge());

      expect(orderRepo.save).not.toHaveBeenCalled();
    });

    it('never downgrades a paid order', async () => {
      orderRepo.findOne.mockResolvedValue(
        makeOrder({ paymentStatus: PaymentStatus.PAID }),
      );
      client.getCharge.mockResolvedValue(gatewayData({ status: 'FAILED' }));

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
      expect(client.createCharge).not.toHaveBeenCalled();
    });

    it('returns the live attempt instead of stacking charges', async () => {
      chargeRepo.findOne.mockResolvedValue(makeCharge()); // live REQUIRES_ACTION

      const result = await service.createChargeForClient('client-1', 'order-1');

      expect(result.reference).toBe('MCH123');
      expect(client.createCharge).not.toHaveBeenCalled();
      // Non-terminal → it was refreshed from the gateway.
      expect(client.getCharge).toHaveBeenCalledWith('MCH123');
    });

    it('creates a new charge after the previous attempt expired', async () => {
      chargeRepo.findOne
        .mockResolvedValueOnce(makeCharge({ status: ChargeStatus.EXPIRED }))
        .mockResolvedValue(null);
      chargeRepo.count.mockResolvedValue(1);

      await service.createChargeForClient('client-1', 'order-1');

      expect(client.createCharge).toHaveBeenCalledWith(
        expect.objectContaining({
          idempotency_key: 'order_ORD-20260001_crypto_2',
        }),
      );
    });
  });

  describe('handleWebhook', () => {
    const event = {
      event: 'charge.succeeded',
      reference: 'MCH123',
      status: 'SUCCEEDED',
      net_amount: '29.25000000',
      metadata: { order_id: 'order-1' },
    };
    const body = JSON.stringify(event);
    const sign = (payload: string, secret = SECRET) =>
      createHmac('sha256', secret).update(payload).digest('hex');

    it('rejects an invalid signature', async () => {
      await expect(
        service.handleWebhook(body, { 'x-mibi-signature': 'deadbeef' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('applies a valid terminal event and pays the order', async () => {
      chargeRepo.findOne.mockResolvedValue(makeCharge());

      const result = await service.handleWebhook(body, {
        'x-mibi-signature': sign(body),
      });

      expect(result).toEqual({ processed: true });
      expect(chargeRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          status: ChargeStatus.SUCCEEDED,
          settlementAmount: '29.25000000',
        }),
      );
      expect(orderRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ paymentStatus: PaymentStatus.PAID }),
      );
    });

    it('is idempotent for re-delivered terminal events', async () => {
      chargeRepo.findOne.mockResolvedValue(
        makeCharge({ status: ChargeStatus.SUCCEEDED }),
      );

      const result = await service.handleWebhook(body, {
        'x-mibi-signature': sign(body),
      });

      expect(result).toEqual({ processed: true });
      expect(chargeRepo.save).not.toHaveBeenCalled();
      expect(orderRepo.save).not.toHaveBeenCalled();
    });

    it('tolerates unknown references without failing', async () => {
      chargeRepo.findOne.mockResolvedValue(null);

      const result = await service.handleWebhook(body, {
        'x-mibi-signature': sign(body),
      });

      expect(result).toEqual({ processed: false });
    });

    it('bypasses verification with a warning when no secret is set outside production', async () => {
      config.get.mockImplementation((key: string) => {
        if (key === 'mibi') return { webhookSecret: undefined };
        if (key === 'nodeEnv') return 'test';
        return undefined;
      });
      chargeRepo.findOne.mockResolvedValue(makeCharge());

      const result = await service.handleWebhook(body, {});

      expect(result).toEqual({ processed: true });
    });

    it('hard-fails on a missing secret in production', async () => {
      config.get.mockImplementation((key: string) => {
        if (key === 'mibi') return { webhookSecret: undefined };
        if (key === 'nodeEnv') return 'production';
        return undefined;
      });

      await expect(service.handleWebhook(body, {})).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });
  });
});
