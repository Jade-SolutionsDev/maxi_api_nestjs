import { Test, TestingModule } from '@nestjs/testing';
import { Order } from '../../../orders/entities/order.entity';
import { ChargeStatus } from '../../entities/payment-charge.entity';
import { PaymentMethod } from '../../entities/payment-method.entity';
import { CustomManualGateway } from './custom-manual.gateway';

const order = { id: 'order-1', orderNumber: 'ORD-1', total: '42.00' } as Order;

const method = (overrides: Partial<PaymentMethod> = {}): PaymentMethod =>
  ({
    code: 'transfermovil',
    label: 'Transfermóvil',
    instructions: { type: 'qr', imageUrl: 'https://cdn/qr.png', note: null },
    ...overrides,
  }) as PaymentMethod;

describe('CustomManualGateway', () => {
  let gateway: CustomManualGateway;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [CustomManualGateway],
    }).compile();
    gateway = module.get(CustomManualGateway);
  });

  it('deja el cobro pendiente: sólo un admin lo confirma', async () => {
    const charge = await gateway.createCharge(order, 'key-1', method());

    expect(charge.status).toBe(ChargeStatus.PENDING);
    expect(charge.amount).toBe('42.00');
  });

  // Copia, no referencia: si mañana cambian la cuenta, este pedido tiene que
  // seguir contando dónde se pagó.
  it('copia las instrucciones dentro del cobro', async () => {
    const charge = await gateway.createCharge(order, 'key-1', method());

    expect(charge.actionPayload).toMatchObject({
      methodLabel: 'Transfermóvil',
      instructions: { type: 'qr', imageUrl: 'https://cdn/qr.png' },
    });
  });

  it('guarda la red de una dirección de cripto', async () => {
    const charge = await gateway.createCharge(
      order,
      'key-1',
      method({
        code: 'usdt',
        label: 'USDT',
        instructions: {
          type: 'crypto',
          address: '0xabc',
          network: 'BEP20',
          asset: 'USDT',
          memo: null,
          note: null,
        },
      }),
    );

    expect(charge.actionPayload).toMatchObject({
      instructions: { network: 'BEP20', address: '0xabc' },
    });
  });

  it('no revienta si el método llega sin instrucciones', async () => {
    const charge = await gateway.createCharge(
      order,
      'key-1',
      method({ instructions: null }),
    );

    expect(charge.actionPayload).toMatchObject({ instructions: null });
  });

  it('no atiende webhooks', () => {
    expect(() => gateway.parseWebhook()).toThrow();
  });
});
