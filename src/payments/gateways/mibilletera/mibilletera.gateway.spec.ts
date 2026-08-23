import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { createHmac } from 'node:crypto';
import { Order } from '../../../orders/entities/order.entity';
import { ChargeStatus } from '../../entities/payment-charge.entity';
import { MibiClient } from './mibi-client';
import { MibilleteraGateway } from './mibilletera.gateway';

const SECRET = 'whsec_test';

const event = {
  event: 'charge.succeeded',
  reference: 'MCH123',
  status: 'SUCCEEDED',
  net_amount: '29.25000000',
};
const body = JSON.stringify(event);
const sign = (payload: string, secret = SECRET) =>
  createHmac('sha256', secret).update(payload).digest('hex');

describe('MibilleteraGateway', () => {
  let gateway: MibilleteraGateway;
  let client: { createCharge: jest.Mock; getCharge: jest.Mock };
  let config: { get: jest.Mock };
  let mibi: Record<string, unknown>;
  let nodeEnv: string;

  beforeEach(async () => {
    mibi = { configured: true, webhookSecret: SECRET, currency: 'USDT' };
    nodeEnv = 'test';
    client = {
      createCharge: jest.fn().mockResolvedValue({
        reference: 'MCH123',
        amount: '30.00000000',
        currency: 'USDT',
        status: 'REQUIRES_ACTION',
        action_payload: { deposit_address: '0xabc', blockchain: 'BEP20' },
      }),
      getCharge: jest.fn(),
    };
    config = {
      get: jest.fn((key: string) =>
        key === 'payments' ? { mibi } : key === 'nodeEnv' ? nodeEnv : undefined,
      ),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MibilleteraGateway,
        { provide: MibiClient, useValue: client },
        { provide: ConfigService, useValue: config },
      ],
    }).compile();

    gateway = module.get(MibilleteraGateway);
  });

  it('creates a CRYPTO charge in the configured settlement currency', async () => {
    const charge = await gateway.createCharge(
      { id: 'order-1', orderNumber: 'ORD-20260001', total: '30.00' } as Order,
      'order_ORD-20260001_mibilletera_1',
    );

    expect(client.createCharge).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'CRYPTO',
        amount: '30.00',
        currency: 'USDT',
        idempotency_key: 'order_ORD-20260001_mibilletera_1',
        metadata: { order_id: 'order-1' },
      }),
    );
    // The deposit instructions must come from the gateway, never hardcoded.
    expect(charge.actionPayload).toEqual({
      deposit_address: '0xabc',
      blockchain: 'BEP20',
    });
  });

  it('accepts a correctly signed webhook', () => {
    const parsed = gateway.parseWebhook(body, {
      'x-mibi-signature': sign(body),
    });

    expect(parsed.reference).toBe('MCH123');
    expect(parsed.charge.status).toBe(ChargeStatus.SUCCEEDED);
    expect(parsed.charge.settlementAmount).toBe('29.25000000');
  });

  it('rejects an invalid signature', () => {
    expect(() =>
      gateway.parseWebhook(body, { 'x-mibi-signature': 'deadbeef' }),
    ).toThrow(UnauthorizedException);
  });

  it('bypasses verification with a warning when no secret is set outside production', () => {
    mibi.webhookSecret = undefined;

    expect(gateway.parseWebhook(body, {}).reference).toBe('MCH123');
  });

  it('hard-fails on a missing secret in production', () => {
    mibi.webhookSecret = undefined;
    nodeEnv = 'production';

    expect(() => gateway.parseWebhook(body, {})).toThrow(UnauthorizedException);
  });
});
