import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import request from 'supertest';
import { Repository } from 'typeorm';
import { AppModule } from '../src/app.module';
import { CartItem } from '../src/cart/entities/cart-item.entity';
import { Category } from '../src/categories/entities/category.entity';
import { Client } from '../src/clients/entities/client.entity';
import { Inventory } from '../src/inventory/entities/inventory.entity';
import { Product } from '../src/products/entities/product.entity';
import { Role, User } from '../src/users/entities/user.entity';
import { configureApp } from './test-setup';

// Mock auth backend: both ClientAuthService and the backoffice AuthService
// resolve tokens via AUTH_PROVIDER, so `mock:<clerkId>` works for both sides.
process.env.MOCK_AUTH_ENABLED = 'true';

const TABLES =
  'order_items, orders, inventory_reservations, cart_items, inventory, products, categories, clients, users';

const CRON_SECRET = 'orders_e2e_cron';
process.env.CRON_SECRET = CRON_SECRET;

describe('Orders (e2e)', () => {
  let app: INestApplication;
  let clients: Repository<Client>;
  let users: Repository<User>;
  let products: Repository<Product>;
  let categories: Repository<Category>;
  let inventory: Repository<Inventory>;
  let productId: string;

  const clientAuth = { Authorization: 'Bearer mock:clerk_client_1' };
  const adminAuth = { Authorization: 'Bearer mock:clerk_admin_1' };
  const locationId = '00000000-0000-0000-0000-000000000002';

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication({ bodyParser: false });
    configureApp(app);
    await app.init();

    clients = moduleRef.get(getRepositoryToken(Client));
    users = moduleRef.get(getRepositoryToken(User));
    products = moduleRef.get(getRepositoryToken(Product));
    categories = moduleRef.get(getRepositoryToken(Category));
    inventory = moduleRef.get(getRepositoryToken(Inventory));
    void moduleRef.get(getRepositoryToken(CartItem)); // ensures table exists
  });

  beforeEach(async () => {
    await clients.query(`TRUNCATE TABLE ${TABLES} CASCADE`);
    await clients.save(
      clients.create({ clerkId: 'clerk_client_1', email: 'c1@example.com' }),
    );
    await users.save(
      users.create({
        clerkId: 'clerk_admin_1',
        email: 'admin@example.com',
        role: Role.ADMIN,
        isActive: true,
      }),
    );
    const category = await categories.save(
      categories.create({
        name: 'Refrescos',
        slug: 'refrescos',
        parentId: '00000000-0000-0000-0000-000000000001',
      }),
    );
    const product = await products.save(
      products.create({
        categoryId: category.id,
        sku: 'COLA-1L',
        name: 'Cola 1L',
        slug: 'cola-1l',
        measureUnit: 'unidad',
        basePrice: '10.00',
        discount: '0.00',
      }),
    );
    productId = product.id;
    // Availability only counts enabled stock_locations — the storage row must
    // exist and be active.
    await clients.query(
      `INSERT INTO stock_locations (id, name, is_active)
       VALUES ($1, 'E2E Storage', true)
       ON CONFLICT (id) DO NOTHING`,
      [locationId],
    );
    await inventory.save(
      inventory.create({ locationId, productId, quantity: 5 }),
    );
    // Checkout refuses when the shop can fulfil nothing, so the fixture has to
    // say how it fulfils. One enabled option with no zones = delivery anywhere,
    // which is what these tests exercise.
    await clients.query(`DELETE FROM delivery_options`);
    await clients.query(
      `INSERT INTO delivery_options (label, fee, enabled) VALUES ('E2E Delivery', 0, true)`,
    );
  });

  afterAll(async () => {
    await clients.query(`TRUNCATE TABLE ${TABLES} CASCADE`);
    await app.close();
  });

  async function addToCartAndCheckout(quantity: number) {
    await request(app.getHttpServer())
      .post('/api/cart/items')
      .set(clientAuth)
      .send({ productId, quantity })
      .expect(201);
    const res = await request(app.getHttpServer())
      .post('/api/storefront/orders')
      .set(clientAuth)
      .send({ customerNotes: 'ring the bell' })
      .expect(201);
    return res.body.data as {
      id: string;
      orderNumber: string;
      status: string;
      paymentStatus: string;
      subtotal: number;
      total: number;
      items: { quantity: number; unitPrice: number }[];
    };
  }

  async function publicAvailability(): Promise<number> {
    const res = await request(app.getHttpServer())
      .get(`/api/public/products/${productId}`)
      .expect(200);
    return res.body.data.available as number;
  }

  async function physicalRow() {
    return (await inventory.findOne({
      where: { locationId, productId },
    })) as Inventory;
  }

  it('rejects requests without a token', async () => {
    await request(app.getHttpServer())
      .get('/api/storefront/orders')
      .expect(401);
    await request(app.getHttpServer()).get('/api/orders').expect(401);
  });

  it('checkout reserves stock: public availability drops, physical stock does not', async () => {
    const order = await addToCartAndCheckout(3);

    expect(order.orderNumber).toMatch(/^ORD-\d{4}\d{4,}$/);
    expect(order.status).toBe('pending');
    expect(order.paymentStatus).toBe('pending');
    expect(order.subtotal).toBe(30);
    expect(order.items[0].unitPrice).toBe(10);

    // The user-visible guarantee: reserved stock is not sellable...
    expect(await publicAvailability()).toBe(2);
    // ...but the warehouse still physically holds all 5 units.
    const row = await physicalRow();
    expect(row.quantity).toBe(5);
    expect(row.reservedQuantity).toBe(3);

    // The cart was cleared by checkout.
    const cart = await request(app.getHttpServer())
      .get('/api/cart')
      .set(clientAuth)
      .expect(200);
    expect(cart.body.data.items).toHaveLength(0);

    // Another shopper cannot cart more than what is left.
    const overCart = await request(app.getHttpServer())
      .post('/api/cart/items')
      .set(clientAuth)
      .send({ productId, quantity: 3 })
      .expect(409);
    expect(overCart.body.error.details[0].available).toBe(2);
  });

  it('admin confirmation physically decrements the reserved stock', async () => {
    const order = await addToCartAndCheckout(3);

    await request(app.getHttpServer())
      .patch(`/api/orders/${order.id}/status`)
      .set(adminAuth)
      .send({ status: 'confirmed' })
      .expect(200);

    const row = await physicalRow();
    expect(row.quantity).toBe(2);
    expect(row.reservedQuantity).toBe(0);
    expect(await publicAvailability()).toBe(2);
  });

  it('client cancel while pending releases the hold', async () => {
    const order = await addToCartAndCheckout(3);
    expect(await publicAvailability()).toBe(2);

    const cancelled = await request(app.getHttpServer())
      .post(`/api/storefront/orders/${order.id}/cancel`)
      .set(clientAuth)
      .expect(201);
    expect(cancelled.body.data.status).toBe('cancelled');

    expect(await publicAvailability()).toBe(5);
    const row = await physicalRow();
    expect(row.quantity).toBe(5);
    expect(row.reservedQuantity).toBe(0);
  });

  it('client cannot cancel a confirmed order; admin cancel restocks', async () => {
    const order = await addToCartAndCheckout(3);
    await request(app.getHttpServer())
      .patch(`/api/orders/${order.id}/status`)
      .set(adminAuth)
      .send({ status: 'confirmed' })
      .expect(200);

    await request(app.getHttpServer())
      .post(`/api/storefront/orders/${order.id}/cancel`)
      .set(clientAuth)
      .expect(409);

    // Admin cancel after confirmation returns the goods to stock.
    await request(app.getHttpServer())
      .patch(`/api/orders/${order.id}/status`)
      .set(adminAuth)
      .send({ status: 'cancelled' })
      .expect(200);
    const row = await physicalRow();
    expect(row.quantity).toBe(5);
    expect(row.reservedQuantity).toBe(0);
  });

  it('admin lists and settles payment manually', async () => {
    const order = await addToCartAndCheckout(2);

    const list = await request(app.getHttpServer())
      .get('/api/orders?status=pending&q=c1@example.com')
      .set(adminAuth)
      .expect(200);
    expect(list.body.data.meta.total).toBe(1);
    expect(list.body.data.data[0].clientEmail).toBe('c1@example.com');

    // Filter by customer (drives the client-detail orders tab).
    const clientId = list.body.data.data[0].clientId as string;
    const byClient = await request(app.getHttpServer())
      .get(`/api/orders?clientId=${clientId}`)
      .set(adminAuth)
      .expect(200);
    expect(byClient.body.data.meta.total).toBe(1);
    const byOther = await request(app.getHttpServer())
      .get('/api/orders?clientId=00000000-0000-4000-8000-000000000009')
      .set(adminAuth)
      .expect(200);
    expect(byOther.body.data.meta.total).toBe(0);

    const paid = await request(app.getHttpServer())
      .patch(`/api/orders/${order.id}/payment-status`)
      .set(adminAuth)
      .send({ paymentStatus: 'paid' })
      .expect(200);
    expect(paid.body.data.paymentStatus).toBe('paid');
  });

  it('exposes the order history to the customer', async () => {
    await addToCartAndCheckout(1);

    const res = await request(app.getHttpServer())
      .get('/api/storefront/orders')
      .set(clientAuth)
      .expect(200);
    expect(res.body.data.meta.total).toBe(1);
    expect(res.body.data.data[0].items).toHaveLength(1);
  });

  // The expiry sweep releases holds through releaseReservations(manager, id)
  // with no acting user. That is only safe because it touches pending orders,
  // which can never carry a confirmed (restockable) allocation — the ledger
  // work made that path throw when a restock has no admin behind it.
  it('expiring an unpaid order releases its hold and returns the stock to the shop', async () => {
    const order = await addToCartAndCheckout(3);

    expect(await publicAvailability()).toBe(2);

    // Both: the window runs from the newest payment attempt, and checkout
    // just created one (the manual fallback, since no gateway is configured
    // under NODE_ENV=test).
    const twoDaysAgo = new Date(Date.now() - 48 * 60 * 60 * 1000);
    await inventory.query(`UPDATE orders SET created_at = $1`, [twoDaysAgo]);
    await inventory.query(`UPDATE payment_charges SET created_at = $1`, [
      twoDaysAgo,
    ]);

    const res = await request(app.getHttpServer())
      .post('/api/internal/orders/expire')
      .set('x-cron-secret', CRON_SECRET)
      .expect(200);

    expect(res.body.data.cancelled).toBe(1);

    /**
     * La reserva queda marcada como caducada, no como cancelada: son dos cosas
     * distintas y `MxH-0078` pedia poder medirlas por separado — cuanto stock
     * retienen los pedidos que nadie paga es lo que dice si el plazo esta bien
     * puesto.
     */
    const estados = await inventory.query(
      `SELECT status, count(*)::int AS n FROM inventory_reservations GROUP BY status`,
    );
    expect(estados).toEqual([{ status: 'expired', n: 1 }]);

    const row = await physicalRow();
    expect(row.reservedQuantity).toBe(0);
    expect(row.quantity).toBe(5);
    // Back on sale, and no phantom sale was written to the ledger.
    expect(await publicAvailability()).toBe(5);
    const sales = await inventory.query(
      `SELECT count(*)::int AS n FROM inventory_operations WHERE order_id = $1`,
      [order.id],
    );
    expect(sales[0].n).toBe(0);
  });

  // The state the shop is actually in at launch: no delivery, pickup only.
  describe('pickup', () => {
    const secondLocationId = '8f14e45f-ceea-467a-9f8a-2b9c2f2a9b21';

    beforeEach(async () => {
      await clients.query(`DELETE FROM delivery_options`);
      await clients.query(`DELETE FROM stock_location_pickup_addresses`);
      await clients.query(
        `INSERT INTO stock_location_pickup_addresses (location_id, label, address)
         VALUES ($1, 'Mostrador', 'Calle 1 #2, Centro')`,
        [locationId],
      );
    });

    const pickupPoint = async (): Promise<{
      deliveryOptions: { id: string }[];
      pickupPoints: { id: string }[];
      unavailableMessage: string | null;
    }> => {
      const res = await request(app.getHttpServer())
        .get('/api/storefront/fulfillment')
        .set(clientAuth)
        .expect(200);
      return res.body.data as {
        deliveryOptions: { id: string }[];
        pickupPoints: { id: string }[];
        unavailableMessage: string | null;
      };
    };

    it('offers pickup and nothing else when no delivery option exists', async () => {
      const offer = await pickupPoint();

      expect(offer.deliveryOptions).toEqual([]);
      expect(offer.pickupPoints).toHaveLength(1);
      expect(offer.unavailableMessage).toBeNull();
    });

    it('holds the stock in the storage the customer collects from', async () => {
      // A second storage with stock: the reservation must not drift to it.
      await clients.query(
        `INSERT INTO stock_locations (id, name, is_active)
         VALUES ($1, 'Far Warehouse', true) ON CONFLICT (id) DO NOTHING`,
        [secondLocationId],
      );
      await inventory.save(
        inventory.create({
          locationId: secondLocationId,
          productId,
          quantity: 50,
        }),
      );

      const offer = await pickupPoint();
      await request(app.getHttpServer())
        .post('/api/cart/items')
        .set(clientAuth)
        .send({ productId, quantity: 2 })
        .expect(201);

      const res = await request(app.getHttpServer())
        .post('/api/storefront/orders')
        .set(clientAuth)
        .send({
          fulfillmentType: 'pickup',
          pickupAddressId: offer.pickupPoints[0].id,
        })
        .expect(201);

      expect(res.body.data.fulfillmentType).toBe('pickup');
      expect(res.body.data.pickupAddress).toMatchObject({
        address: 'Calle 1 #2, Centro',
      });
      expect(res.body.data.deliveryFee).toBe(0);

      const held = await clients.query(
        `SELECT location_id, quantity FROM inventory_reservations WHERE order_id = $1`,
        [res.body.data.id],
      );
      expect(held).toHaveLength(1);
      expect(held[0].location_id).toBe(locationId);
    });

    it('blocks checkout when pickup is off and nothing else is offered', async () => {
      await clients.query(
        `UPDATE fulfillment_settings SET data = jsonb_set(data, '{pickupEnabled}', 'false')`,
      );
      await request(app.getHttpServer())
        .post('/api/cart/items')
        .set(clientAuth)
        .send({ productId, quantity: 1 })
        .expect(201);

      const offer = await pickupPoint();
      expect(offer.unavailableMessage).toBeTruthy();

      await request(app.getHttpServer())
        .post('/api/storefront/orders')
        .set(clientAuth)
        .send({ fulfillmentType: 'pickup' })
        .expect(400);

      await clients.query(
        `UPDATE fulfillment_settings SET data = jsonb_set(data, '{pickupEnabled}', 'true')`,
      );
    });

    it('says to contact support when no storage has a pickup address', async () => {
      await clients.query(`DELETE FROM stock_location_pickup_addresses`);

      const offer = await pickupPoint();

      expect(offer.pickupPoints).toEqual([]);
      expect(offer.unavailableMessage).toBeTruthy();
    });
  });

  describe('coverage-scoped fulfillment', () => {
    const otherLocationId = '8f14e45f-ceea-467a-9f8a-2b9c2f2a9b21';
    let municipalityId: string;

    beforeEach(async () => {
      const [municipality] = await clients.query(
        `SELECT id FROM municipalities LIMIT 1`,
      );
      municipalityId = municipality.id;

      await clients.query(`DELETE FROM stock_location_pickup_addresses`);
      await clients.query(`DELETE FROM stock_location_coverage`);
      await clients.query(
        `INSERT INTO stock_locations (id, name, is_active)
         VALUES ($1, 'Far Warehouse', true) ON CONFLICT (id) DO NOTHING`,
        [otherLocationId],
      );
      await clients.query(
        `UPDATE stock_locations SET is_active = true, deleted_at = NULL WHERE id = $1`,
        [otherLocationId],
      );
      await clients.query(
        `INSERT INTO stock_location_pickup_addresses (location_id, label, address) VALUES
         ($1, 'Mostrador', 'Calle 1 #2, Centro'),
         ($2, 'Nave', 'Carretera Vieja km 3')`,
        [locationId, otherLocationId],
      );
      // Only the main storage covers the customer's municipality.
      await clients.query(
        `INSERT INTO stock_location_coverage (location_id, coverage_type, province_id, municipality_id)
         SELECT $1, 'municipality', m.province_id, m.id FROM municipalities m WHERE m.id = $2`,
        [locationId, municipalityId],
      );
    });

    afterEach(async () => {
      await clients.query(`DELETE FROM stock_location_coverage`);
      await clients.query(`DELETE FROM inventory WHERE location_id = $1`, [
        otherLocationId,
      ]);
    });

    const offerFor = async (municipality: string) => {
      const res = await request(app.getHttpServer())
        .get(`/api/storefront/fulfillment?municipalityId=${municipality}`)
        .set(clientAuth)
        .expect(200);
      return res.body.data as {
        pickupPoints: { id: string; locationId: string }[];
      };
    };

    it('only offers pickup counters of storages covering the municipality', async () => {
      const offer = await offerFor(municipalityId);

      expect(offer.pickupPoints).toHaveLength(1);
      expect(offer.pickupPoints[0].locationId).toBe(locationId);
    });

    it('multi-storage pickup succeeds and flags the order for a transfer', async () => {
      // Second storage also covers the municipality and holds the overflow.
      await clients.query(
        `INSERT INTO stock_location_coverage (location_id, coverage_type, province_id, municipality_id)
         SELECT $1, 'municipality', m.province_id, m.id FROM municipalities m WHERE m.id = $2`,
        [otherLocationId, municipalityId],
      );
      await inventory.save(
        inventory.create({
          locationId: otherLocationId,
          productId,
          quantity: 50,
        }),
      );

      const offer = await offerFor(municipalityId);
      const counter = offer.pickupPoints.find(
        (p) => p.locationId === locationId,
      ) as { id: string };
      await request(app.getHttpServer())
        .post('/api/cart/items')
        .set(clientAuth)
        .send({ productId, quantity: 7 }) // main storage only holds 5
        .expect(201);

      const res = await request(app.getHttpServer())
        .post('/api/storefront/orders')
        .set(clientAuth)
        .send({
          fulfillmentType: 'pickup',
          pickupAddressId: counter.id,
          deliveryMunicipalityId: municipalityId,
        })
        .expect(201);
      const orderId = res.body.data.id as string;

      // Preference drained the counter first; the rest sits at the sibling.
      const held = await clients.query(
        `SELECT location_id, quantity FROM inventory_reservations WHERE order_id = $1 ORDER BY quantity DESC`,
        [orderId],
      );
      expect(held).toHaveLength(2);
      expect(held[0]).toMatchObject({ location_id: locationId, quantity: 5 });
      expect(held[1]).toMatchObject({
        location_id: otherLocationId,
        quantity: 2,
      });

      const detail = await request(app.getHttpServer())
        .get(`/api/orders/${orderId}`)
        .set(adminAuth)
        .expect(200);
      expect(detail.body.data.needsTransfer).toBe(true);
      expect(detail.body.data.reservationStorages).toHaveLength(2);

      const flagged = await request(app.getHttpServer())
        .get('/api/orders?needsTransfer=true')
        .set(adminAuth)
        .expect(200);
      expect(flagged.body.data.meta.total).toBe(1);
      expect(flagged.body.data.data[0].id).toBe(orderId);

      // Confirmation settles the holds; the queue clears itself.
      await request(app.getHttpServer())
        .patch(`/api/orders/${orderId}/status`)
        .set(adminAuth)
        .send({ status: 'confirmed' })
        .expect(200);
      const confirmed = await request(app.getHttpServer())
        .get(`/api/orders/${orderId}`)
        .set(adminAuth)
        .expect(200);
      expect(confirmed.body.data.needsTransfer).toBe(false);
      expect(confirmed.body.data.reservationStorages).toHaveLength(2);
    });

    it('delivery never reserves at a storage outside the coverage', async () => {
      // Far Warehouse has plenty of stock but does NOT cover the municipality.
      await inventory.save(
        inventory.create({
          locationId: otherLocationId,
          productId,
          quantity: 50,
        }),
      );

      await request(app.getHttpServer())
        .post('/api/cart/items')
        .set(clientAuth)
        .send({ productId, quantity: 3 })
        .expect(201);
      const res = await request(app.getHttpServer())
        .post('/api/storefront/orders')
        .set(clientAuth)
        .send({ deliveryMunicipalityId: municipalityId })
        .expect(201);

      const held = await clients.query(
        `SELECT location_id FROM inventory_reservations WHERE order_id = $1`,
        [res.body.data.id],
      );
      expect(held).toHaveLength(1);
      expect(held[0].location_id).toBe(locationId);

      const far = await inventory.findOne({
        where: { locationId: otherLocationId, productId },
      });
      expect(far?.reservedQuantity).toBe(0);
    });
  });
});
