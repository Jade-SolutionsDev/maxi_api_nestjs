import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import request from 'supertest';
import { Repository } from 'typeorm';
import { AppModule } from '../src/app.module';
import { CartItem } from '../src/cart/entities/cart-item.entity';
import { Client } from '../src/clients/entities/client.entity';
import { Product } from '../src/products/entities/product.entity';
import { configureApp } from './test-setup';

// Mock auth backend: tokens shaped `mock:<clerkId>` authenticate as that
// clerkId (see MockAuthProvider). Must be set before the module compiles.
process.env.MOCK_AUTH_ENABLED = 'true';

describe('Cart (e2e)', () => {
  let app: INestApplication;
  let cartItems: Repository<CartItem>;
  let clients: Repository<Client>;
  let products: Repository<Product>;
  let productId: string;

  const token = 'mock:clerk_client_1';
  const auth = { Authorization: `Bearer ${token}` };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication({ bodyParser: false });
    configureApp(app);
    await app.init();

    cartItems = moduleRef.get(getRepositoryToken(CartItem));
    clients = moduleRef.get(getRepositoryToken(Client));
    products = moduleRef.get(getRepositoryToken(Product));
  });

  beforeEach(async () => {
    await cartItems.query(
      'TRUNCATE TABLE cart_items, inventory, products, clients CASCADE',
    );
    await clients.save(
      clients.create({ clerkId: 'clerk_client_1', email: 'c1@example.com' }),
    );
    const product = await products.save(
      products.create({
        categoryId: '00000000-0000-0000-0000-000000000001',
        sku: 'COLA-1L',
        name: 'Cola 1L',
        slug: 'cola-1l',
        measureUnit: 'unidad',
        basePrice: '10.00',
        discount: '25.00',
      }),
    );
    productId = product.id;
    // 5 units of stock at one ACTIVE storage — availability only counts
    // enabled stock_locations, so the location row must exist.
    await cartItems.query(
      `INSERT INTO stock_locations (id, name, is_active)
       VALUES ('00000000-0000-0000-0000-000000000002', 'E2E Storage', true)
       ON CONFLICT (id) DO NOTHING`,
    );
    await cartItems.query(
      `INSERT INTO inventory (location_id, product_id, quantity)
       VALUES ('00000000-0000-0000-0000-000000000002', $1, 5)`,
      [productId],
    );
  });

  afterAll(async () => {
    await cartItems.query(
      'TRUNCATE TABLE cart_items, inventory, products, clients CASCADE',
    );
    await app.close();
  });

  it('rejects requests without a token', async () => {
    await request(app.getHttpServer()).get('/api/cart').expect(401);
  });

  it('add -> get -> patch -> delete, with server-side prices', async () => {
    const server = app.getHttpServer();

    // Add 2 units; prices come back computed from basePrice/discount.
    const added = await request(server)
      .post('/api/cart/items')
      .set(auth)
      .send({ productId, quantity: 2 })
      .expect(201);
    expect(added.body.data.items).toHaveLength(1);
    expect(added.body.data.items[0].unitPrice).toBe(7.5);
    expect(added.body.data.items[0].lineTotal).toBe(15);
    expect(added.body.data.subtotal).toBe(15);

    // POST increments the existing line.
    const incremented = await request(server)
      .post('/api/cart/items')
      .set(auth)
      .send({ productId, quantity: 1 })
      .expect(201);
    expect(incremented.body.data.items[0].quantity).toBe(3);

    // "Another device" = same account: the cart is there on a fresh GET.
    const fetched = await request(server)
      .get('/api/cart')
      .set(auth)
      .expect(200);
    expect(fetched.body.data.items[0].quantity).toBe(3);
    expect(fetched.body.data.totalItems).toBe(3);

    // PATCH sets the absolute quantity.
    const patched = await request(server)
      .patch(`/api/cart/items/${productId}`)
      .set(auth)
      .send({ quantity: 5 })
      .expect(200);
    expect(patched.body.data.items[0].quantity).toBe(5);
    expect(patched.body.data.subtotal).toBe(37.5);

    // DELETE removes the line.
    const removed = await request(server)
      .delete(`/api/cart/items/${productId}`)
      .set(auth)
      .expect(200);
    expect(removed.body.data.items).toHaveLength(0);
    expect(removed.body.data.subtotal).toBe(0);
  });

  it('409s when the requested quantity exceeds stock, with available in details', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/cart/items')
      .set(auth)
      .send({ productId, quantity: 6 })
      .expect(409);

    expect(response.body.error.details[0].available).toBe(5);
  });

  it('clears the cart', async () => {
    const server = app.getHttpServer();
    await request(server)
      .post('/api/cart/items')
      .set(auth)
      .send({ productId, quantity: 1 })
      .expect(201);

    const cleared = await request(server)
      .delete('/api/cart')
      .set(auth)
      .expect(200);
    expect(cleared.body.data.items).toHaveLength(0);
  });
});
