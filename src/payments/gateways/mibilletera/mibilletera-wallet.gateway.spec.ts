import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { Order } from '../../../orders/entities/order.entity';
import { ChargeStatus } from '../../entities/payment-charge.entity';
import { MibiClient } from './mibi-client';
import { MibilleteraWalletGateway } from './mibilletera-wallet.gateway';

const order = () =>
  ({ id: 'order-1', orderNumber: 'ORD-20260001', total: '30.00' }) as Order;

describe('MibilleteraWalletGateway', () => {
  let gateway: MibilleteraWalletGateway;
  let client: { createCharge: jest.Mock; getCharge: jest.Mock };

  beforeEach(async () => {
    client = {
      createCharge: jest.fn().mockResolvedValue({
        reference: 'MCH-W-1',
        amount: '30.00',
        currency: 'miUSD',
        status: 'REQUIRES_ACTION',
        // A wallet charge answers with a payment request, not an address.
        action_payload: {
          operation_number: 'PR-90210',
          qr_data: { raw: 'mibilletera://pay/PR-90210' },
        },
      }),
      getCharge: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MibilleteraWalletGateway,
        { provide: MibiClient, useValue: client },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn(() => ({
              mibi: { configured: true, currency: 'miUSD', webhookSecret: 's' },
            })),
          },
        },
      ],
    }).compile();

    gateway = module.get(MibilleteraWalletGateway);
  });

  it('is a separate option from the crypto one', () => {
    expect(gateway.code).toBe('mibilletera-wallet');
    expect(gateway.kind).toBe('instructions');
  });

  it('asks Mi Billetera for a WALLET charge', async () => {
    await gateway.createCharge(order(), 'order_ORD-20260001_wallet_1');

    expect(client.createCharge).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'WALLET',
        currency: 'miUSD',
        idempotency_key: 'order_ORD-20260001_wallet_1',
      }),
    );
  });

  it('carries the payment request through untouched', async () => {
    const charge = await gateway.createCharge(order(), 'key-1');

    expect(charge.status).toBe(ChargeStatus.REQUIRES_ACTION);
    expect(charge.actionPayload).toEqual({
      operation_number: 'PR-90210',
      qr_data: { raw: 'mibilletera://pay/PR-90210' },
    });
    // Nothing crypto-shaped: the panel branches on the absence of an address.
    expect(charge.actionPayload).not.toHaveProperty('deposit_address');
  });
});
