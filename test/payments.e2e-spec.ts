import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { createHash, createHmac } from 'node:crypto';
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
} from '../src/payments/entities/payment-charge.entity';
import { configureApp } from './test-setup';

// Mock auth backend: tokens shaped `mock:<clerkId>` authenticate as that
// clerkId (see MockAuthProvider). Must be set before the module compiles.
process.env.MOCK_AUTH_ENABLED = 'true';

const CRON_SECRET = 'cron_e2e_secret';
process.env.CRON_SECRET = CRON_SECRET;
// A window of 0 would be rejected as non-positive; 1 minute plus a charge
// backdated well past it is what makes an order due in a test.
process.env.ORDER_EXPIRY_GATEWAY_MINUTES = '1';

const SECRET = 'whsec_e2e_test';
process.env.MIBI_WEBHOOK_SECRET = SECRET;

// Tropipay credentials are read at request time; NODE_ENV=test keeps the
// gateway "unconfigured" (no live calls) but the signature check still runs.
const TPP_ID = 'tpp_e2e_id';
const TPP_SECRET = 'tpp_e2e_secret';
process.env.TROPIPAY_CLIENT_ID = TPP_ID;
process.env.TROPIPAY_CLIENT_SECRET = TPP_SECRET;

const sign = (body: string, secret = SECRET) =>
  createHmac('sha256', secret).update(body).digest('hex');

// sha256(bankOrderCode + clientId + clientSecret + originalCurrencyAmount)
const tropipaySignature = (bankOrderCode: string, amount: string) =>
  createHash('sha256')
    .update(bankOrderCode + TPP_ID + TPP_SECRET + amount)
    .digest('hex');

describe('payment webhooks (e2e)', () => {
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
        provider: 'mibilletera',
        reference: 'MCHE2E123',
        idempotencyKey: 'order_test_mibilletera_1',
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
      .post('/api/webhooks/payments/mibilletera')
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
      .post('/api/webhooks/payments/mibilletera')
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
        .post('/api/webhooks/payments/mibilletera')
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
      .post('/api/webhooks/payments/mibilletera')
      .set('Content-Type', 'application/json')
      .set('X-Mibi-Signature', sign(body))
      .send(body)
      .expect(200);
    expect(res.body.data).toEqual({ processed: false });
  });

  describe('tropipay', () => {
    beforeEach(async () => {
      await charges.save(
        charges.create({
          orderId,
          provider: 'tropipay',
          reference: 'order_test_tropipay_1',
          idempotencyKey: 'order_test_tropipay_1',
          status: ChargeStatus.REQUIRES_ACTION,
          amount: '30.00',
          currency: 'USD',
          redirectUrl: 'https://tppay.me/e2e',
        }),
      );
    });

    const notification = (signature: string) =>
      JSON.stringify({
        status: 'OK',
        data: {
          reference: 'order_test_tropipay_1',
          bankOrderCode: '690259220262',
          originalCurrencyAmount: '3000',
          signaturev2: signature,
          ourFee: 300,
        },
      });

    it('rejects an unsigned notification with 401', async () => {
      await request(app.getHttpServer())
        .post('/api/webhooks/payments/tropipay')
        .set('Content-Type', 'application/json')
        .send(notification('deadbeef'))
        .expect(401);

      const order = await orders.findOneByOrFail({ id: orderId });
      expect(order.paymentStatus).toBe(PaymentStatus.PENDING);
    });

    it('applies a signed OK notification: charge succeeded, order paid', async () => {
      const body = notification(tropipaySignature('690259220262', '3000'));
      const res = await request(app.getHttpServer())
        .post('/api/webhooks/payments/tropipay')
        .set('Content-Type', 'application/json')
        .send(body)
        .expect(200);
      expect(res.body.data).toEqual({ processed: true });

      const charge = await charges.findOneByOrFail({
        reference: 'order_test_tropipay_1',
      });
      expect(charge.status).toBe(ChargeStatus.SUCCEEDED);
      expect(charge.feeAmount).toBe('3.00000000');
      // The redirect link survives an event that never mentions it.
      expect(charge.redirectUrl).toBe('https://tppay.me/e2e');

      const order = await orders.findOneByOrFail({ id: orderId });
      expect(order.paymentStatus).toBe(PaymentStatus.PAID);
    });

    it('routes by provider: a Tropipay body is not accepted as Mi Billetera', async () => {
      const body = notification(tropipaySignature('690259220262', '3000'));
      const res = await request(app.getHttpServer())
        .post('/api/webhooks/payments/mibilletera')
        .set('Content-Type', 'application/json')
        .set('X-Mibi-Signature', sign(body))
        .send(body)
        .expect(200);
      // Parsed as a Mi Billetera event, whose reference field is absent.
      expect(res.body.data).toEqual({ processed: false });
    });
  });

  describe('order list', () => {
    it('names the method each listed order was paid with', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/storefront/orders')
        .set('Authorization', 'Bearer mock:clerk_pay_1')
        .expect(200);

      const [order] = res.body.data.data;
      expect(order.paymentMethod).toEqual({
        code: 'mibilletera',
        label: expect.any(String),
      });
    });

    it('reports the newest attempt when the customer switched method', async () => {
      await charges.save(
        charges.create({
          orderId,
          provider: 'tropipay',
          reference: 'switched_to_tropipay',
          idempotencyKey: 'switched_to_tropipay',
          status: ChargeStatus.REQUIRES_ACTION,
          amount: '30.00',
          currency: 'USD',
        }),
      );

      const res = await request(app.getHttpServer())
        .get('/api/storefront/orders')
        .set('Authorization', 'Bearer mock:clerk_pay_1')
        .expect(200);

      expect(res.body.data.data[0].paymentMethod.code).toBe('tropipay');
    });
  });

  describe('expiry sweep', () => {
    const expire = (secret?: string) => {
      const req = request(app.getHttpServer()).post(
        '/api/internal/orders/expire',
      );
      return secret ? req.set('x-cron-secret', secret) : req;
    };

    // Backdate the order and its charge past the gateway window. The timestamp
    // comes from Node, not from Postgres `now()`: created_at is `timestamp
    // without time zone` and this process runs in a non-UTC zone, so a
    // db-generated value would read back hours off.
    const age = async () => {
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
      await orders.query(`UPDATE orders SET created_at = $2 WHERE id = $1`, [
        orderId,
        twoHoursAgo,
      ]);
      await charges.query(
        `UPDATE payment_charges SET created_at = $2 WHERE order_id = $1`,
        [orderId, twoHoursAgo],
      );
    };

    it('refuses a request with no secret', async () => {
      await expire().expect(403);
    });

    it('refuses a wrong secret', async () => {
      await expire('nope').expect(403);
    });

    it('leaves a fresh order alone', async () => {
      const res = await expire(CRON_SECRET).expect(200);

      expect(res.body.data.cancelled).toBe(0);
      const order = await orders.findOneByOrFail({ id: orderId });
      expect(order.status).toBe(OrderStatus.PENDING);
    });

    it('cancels an order past its window and names the reason', async () => {
      await age();

      const res = await expire(CRON_SECRET).expect(200);

      expect(res.body.data).toMatchObject({ cancelled: 1, orderIds: [orderId] });
      const order = await orders.findOneByOrFail({ id: orderId });
      expect(order.status).toBe(OrderStatus.CANCELLED);
      expect(order.cancellationReason).toBe('payment_not_received');
    });

    it('is a no-op on a second run', async () => {
      await age();
      await expire(CRON_SECRET).expect(200);

      const res = await expire(CRON_SECRET).expect(200);

      expect(res.body.data.cancelled).toBe(0);
    });

    it('spares an order whose payment is still settling', async () => {
      await age();
      await charges.update({ orderId }, { status: ChargeStatus.PROCESSING });

      const res = await expire(CRON_SECRET).expect(200);

      expect(res.body.data.cancelled).toBe(0);
      const order = await orders.findOneByOrFail({ id: orderId });
      expect(order.status).toBe(OrderStatus.PENDING);
    });
  });
});