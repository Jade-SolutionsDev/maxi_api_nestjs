import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { createHash } from 'node:crypto';
import { Order } from '../../../orders/entities/order.entity';
import {
  ChargeStatus,
  PaymentCharge,
} from '../../entities/payment-charge.entity';
import { TropipayClient } from './tropipay-client';
import { TropipayGateway, normalizeCallbackUrl } from './tropipay.gateway';

const CLIENT_ID = 'tpp_id';
const CLIENT_SECRET = 'tpp_secret';

const makeOrder = (overrides: Partial<Order> = {}): Order =>
  ({
    id: 'order-1',
    orderNumber: 'ORD-20260001',
    total: '38.00',
    ...overrides,
  }) as Order;

const makeCharge = (overrides: Partial<PaymentCharge> = {}): PaymentCharge =>
  ({
    reference: 'order_ORD-20260001_tropipay_1',
    status: ChargeStatus.REQUIRES_ACTION,
    amount: '38.00',
    currency: 'USD',
    redirectUrl: 'https://tppay.me/abc',
    lastPayload: null,
    ...overrides,
  }) as PaymentCharge;

// sha256(bankOrderCode + clientId + clientSecret + originalCurrencyAmount)
const sign = (bankOrderCode: string, amount: string) =>
  createHash('sha256')
    .update(bankOrderCode + CLIENT_ID + CLIENT_SECRET + amount)
    .digest('hex');

const notification = (overrides: Record<string, unknown> = {}) => ({
  status: 'OK',
  data: {
    reference: 'order_ORD-20260001_tropipay_1',
    bankOrderCode: '690259220262',
    originalCurrencyAmount: '3800',
    signaturev2: sign('690259220262', '3800'),
    ourFee: 300,
    ...overrides,
  },
});

describe('TropipayGateway', () => {
  let gateway: TropipayGateway;
  let client: {
    config: {
      configured: boolean;
      currency: string;
      clientId: string;
      clientSecret: string;
    };
    createPaymentLink: jest.Mock;
    findMovementByReference: jest.Mock;
    verifySignature: jest.Mock;
  };

  beforeEach(async () => {
    client = {
      config: {
        configured: true,
        currency: 'USD',
        clientId: CLIENT_ID,
        clientSecret: CLIENT_SECRET,
      },
      createPaymentLink: jest.fn().mockResolvedValue({
        shortUrl: 'https://tppay.me/abc',
        paymentUrl: 'https://tropipay.com/pay/abc',
      }),
      findMovementByReference: jest.fn().mockResolvedValue(undefined),
      verifySignature: jest.fn(
        (amount: string, bankOrderCode: string, signature: string) =>
          sign(bankOrderCode, amount) === signature,
      ),
    };

    const config = {
      get: jest.fn((key: string) => {
        if (key === 'storefront') return { url: 'http://localhost:3001' };
        if (key === 'payments')
          return { publicUrl: 'https://tunnel.example.com' };
        return undefined;
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TropipayGateway,
        { provide: TropipayClient, useValue: client },
        { provide: ConfigService, useValue: config },
      ],
    }).compile();

    gateway = module.get(TropipayGateway);
  });

  describe('createCharge', () => {
    it('sends the amount in minor units', async () => {
      await gateway.createCharge(makeOrder(), 'key-1');

      expect(client.createPaymentLink).toHaveBeenCalledWith(
        expect.objectContaining({ amount: 3800, currency: 'USD' }),
      );
    });

    it('rounds fractional totals instead of truncating', async () => {
      await gateway.createCharge(makeOrder({ total: '12.345' }), 'key-1');

      expect(client.createPaymentLink).toHaveBeenCalledWith(
        expect.objectContaining({ amount: 1235 }),
      );
    });

    it('sends the required fields the API 400s without', async () => {
      await gateway.createCharge(makeOrder(), 'key-1');

      expect(client.createPaymentLink).toHaveBeenCalledWith(
        expect.objectContaining({
          reference: 'key-1',
          favorite: false,
          reasonId: expect.any(Number),
          serviceDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
          directPayment: true,
          // All-or-nothing: a partial client object is a common 400.
          client: null,
        }),
      );
    });

    it('rewrites localhost callback URLs to 127.0.0.1 (bare localhost is rejected)', async () => {
      await gateway.createCharge(makeOrder(), 'key-1');

      const payload = client.createPaymentLink.mock.calls[0][0] as Record<
        string,
        string
      >;
      expect(payload.urlSuccess).toBe(
        'http://127.0.0.1:3001/pedidos/order-1?pago=ok',
      );
      expect(payload.urlFailed).toBe(
        'http://127.0.0.1:3001/pedidos/order-1?pago=error',
      );
      expect(payload.urlNotification).toBe(
        'https://tunnel.example.com/api/webhooks/payments/tropipay',
      );
    });

    it('returns the hosted link as a REQUIRES_ACTION charge with no deadline', async () => {
      const charge = await gateway.createCharge(makeOrder(), 'key-1');

      expect(charge).toMatchObject({
        reference: 'key-1',
        status: ChargeStatus.REQUIRES_ACTION,
        redirectUrl: 'https://tppay.me/abc',
        expiresAt: null,
      });
    });

    // The gateway answers "Invalid amount" for anything under its fee-shaped
    // floor; catching it here is what turns a 502 into something a customer
    // can act on.
    it('refuses a total below the minimum before calling the gateway', async () => {
      await expect(
        gateway.createCharge(makeOrder({ total: '1.00' }), 'key-1'),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(client.createPaymentLink).not.toHaveBeenCalled();
    });

    it('names the minimum and the currency so the customer can act', async () => {
      await expect(
        gateway.createCharge(makeOrder({ total: '1.00' }), 'key-1'),
      ).rejects.toThrow(/1\.50 USD/);
    });

    it('accepts a total on the minimum', async () => {
      await gateway.createCharge(makeOrder({ total: '1.50' }), 'key-1');

      expect(client.createPaymentLink).toHaveBeenCalledWith(
        expect.objectContaining({ amount: 150 }),
      );
    });

    it('honours a minimum lowered for the environment', async () => {
      client.config.minAmount = 1;

      await gateway.createCharge(makeOrder({ total: '1.00' }), 'key-1');

      expect(client.createPaymentLink).toHaveBeenCalled();
    });

    it('refuses a currency Tropipay does not settle', async () => {
      client.config.currency = 'CUP';

      await expect(
        gateway.createCharge(makeOrder(), 'key-1'),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(client.createPaymentLink).not.toHaveBeenCalled();
    });
  });

  describe('syncCharge', () => {
    it('promotes to SUCCEEDED when the movement settled', async () => {
      client.findMovementByReference.mockResolvedValue({ state: 2 });

      const result = await gateway.syncCharge(makeCharge());

      expect(result.status).toBe(ChargeStatus.SUCCEEDED);
    });

    it('accepts completedAt as proof of settlement', async () => {
      client.findMovementByReference.mockResolvedValue({
        state: 1,
        completedAt: new Date().toISOString(),
      });

      expect((await gateway.syncCharge(makeCharge())).status).toBe(
        ChargeStatus.SUCCEEDED,
      );
    });

    it('keeps the current status when no movement is visible yet (movements lag)', async () => {
      const result = await gateway.syncCharge(makeCharge());

      expect(result.status).toBe(ChargeStatus.REQUIRES_ACTION);
    });
  });

  describe('parseWebhook', () => {
    it('accepts a correctly signed OK notification', () => {
      const event = gateway.parseWebhook(JSON.stringify(notification()));

      expect(event.reference).toBe('order_ORD-20260001_tropipay_1');
      expect(event.charge.status).toBe(ChargeStatus.SUCCEEDED);
      // Fees arrive in minor units like every other amount.
      expect(event.charge.feeAmount).toBe('3.00');
    });

    it('maps KO to FAILED', () => {
      const event = gateway.parseWebhook(
        JSON.stringify({ ...notification(), status: 'KO' }),
      );

      expect(event.charge.status).toBe(ChargeStatus.FAILED);
    });

    it('rejects a bad signature', () => {
      expect(() =>
        gateway.parseWebhook(
          JSON.stringify(notification({ signaturev2: 'deadbeef' })),
        ),
      ).toThrow(UnauthorizedException);
    });

    it('rejects a malformed body', () => {
      expect(() => gateway.parseWebhook('{"status":"OK"}')).toThrow(
        BadRequestException,
      );
    });
  });
});

describe('normalizeCallbackUrl', () => {
  it('rewrites only the bare localhost hostname', () => {
    expect(normalizeCallbackUrl('https://localhost:3000/x')).toBe(
      'https://127.0.0.1:3000/x',
    );
    expect(normalizeCallbackUrl('https://localhost.example.com/x')).toBe(
      'https://localhost.example.com/x',
    );
    expect(normalizeCallbackUrl('https://example.com/x')).toBe(
      'https://example.com/x',
    );
  });
});
