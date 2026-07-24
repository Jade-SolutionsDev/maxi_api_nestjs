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
    await inventory.save(
      inventory.create({ locationId, productId, quantity: 5 }),
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
});
