import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { createHmac } from 'node:crypto';
import request from 'supertest';
import { Repository } from 'typeorm';
import { AppModule } from '../src/app.module';
import { Client } from '../src/clients/entities/client.entity';
import {
  Order,
  OrderStatus,
  PaymentStatus,
} from '../src/orders/entities/order.entity';
import {
  ChargeStatus,
  PaymentCharge,
} from '../src/orders/payments/entities/payment-charge.entity';
import { configureApp } from './test-setup';

const SECRET = 'whsec_e2e_test';
process.env.MIBI_WEBHOOK_SECRET = SECRET;

const sign = (body: string, secret = SECRET) =>
  createHmac('sha256', secret).update(body).digest('hex');

describe('Mi Billetera webhook (e2e)', () => {
  let app: INestApplication;
  let clients: Repository<Client>;
  let orders: Repository<Order>;
  let charges: Repository<PaymentCharge>;
  let orderId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication({ bodyParser: false });
    configureApp(app);
    await app.init();

    clients = moduleRef.get(getRepositoryToken(Client));
    orders = moduleRef.get(getRepositoryToken(Order));
    charges = moduleRef.get(getRepositoryToken(PaymentCharge));
  });

  beforeEach(async () => {
    await clients.query(
      'TRUNCATE TABLE payment_charges, order_items, orders, clients CASCADE',
    );
    const client = await clients.save(
      clients.create({ clerkId: 'clerk_pay_1', email: 'pay@example.com' }),
    );
    const order = await orders.save(
      orders.create({
        clientId: client.id,
        status: OrderStatus.PENDING,
        paymentStatus: PaymentStatus.PENDING,
        subtotal: '30.00',
        deliveryFee: '0.00',
        total: '30.00',
      }),
    );
    orderId = order.id;
    await charges.save(
      charges.create({
        orderId: order.id,
        reference: 'MCHE2E123',
        idempotencyKey: 'order_test_crypto_1',
        status: ChargeStatus.REQUIRES_ACTION,
        amount: '30.00000000',
        currency: 'USD',
        actionPayload: { deposit_address: '0xabc', token: 'usdt' },
      }),
    );
  });

  afterAll(async () => {
    await clients.query(
      'TRUNCATE TABLE payment_charges, order_items, orders, clients CASCADE',
    );
    await app.close();
  });

  const event = () =>
    JSON.stringify({
      event: 'charge.succeeded',
      reference: 'MCHE2E123',
      status: 'SUCCEEDED',
      method: 'CRYPTO',
      amount: '30.00000000',
      fee_amount: '0.75000000',
      net_amount: '29.25000000',
      currency: 'USD',
      metadata: { order_id: orderId },
      occurred_at: new Date().toISOString(),
    });

  it('rejects an invalid signature with 401', async () => {
    const body = event();
    await request(app.getHttpServer())
      .post('/api/webhooks/mibilletera')
      .set('Content-Type', 'application/json')
      .set('X-Mibi-Signature', sign(body, 'wrong-secret'))
      .send(body)
      .expect(401);

    const order = await orders.findOneByOrFail({ id: orderId });
    expect(order.paymentStatus).toBe(PaymentStatus.PENDING);
  });

  it('applies a signed charge.succeeded: charge terminal, order paid', async () => {
    const body = event();
    const res = await request(app.getHttpServer())
      .post('/api/webhooks/mibilletera')
      .set('Content-Type', 'application/json')
      .set('X-Mibi-Signature', sign(body))
      .send(body)
      .expect(200);
    expect(res.body.data).toEqual({ processed: true });

    const charge = await charges.findOneByOrFail({ reference: 'MCHE2E123' });
    expect(charge.status).toBe(ChargeStatus.SUCCEEDED);
    expect(charge.settlementAmount).toBe('29.25000000');
    expect(charge.completedAt).not.toBeNull();

    const order = await orders.findOneByOrFail({ id: orderId });
    expect(order.paymentStatus).toBe(PaymentStatus.PAID);
  });

  it('is idempotent for duplicate deliveries', async () => {
    const body = event();
    const post = () =>
      request(app.getHttpServer())
        .post('/api/webhooks/mibilletera')
        .set('Content-Type', 'application/json')
        .set('X-Mibi-Signature', sign(body))
        .send(body)
        .expect(200);

    await post();
    await post(); // re-delivery

    const order = await orders.findOneByOrFail({ id: orderId });
    expect(order.paymentStatus).toBe(PaymentStatus.PAID);
  });

  it('tolerates unknown references (200, processed: false)', async () => {
    const body = JSON.stringify({
      event: 'charge.failed',
      reference: 'MCH_UNKNOWN',
      status: 'FAILED',
    });
    const res = await request(app.getHttpServer())
      .post('/api/webhooks/mibilletera')
      .set('Content-Type', 'application/json')
      .set('X-Mibi-Signature', sign(body))
      .send(body)
      .expect(200);
    expect(res.body.data).toEqual({ processed: false });
  });
});
