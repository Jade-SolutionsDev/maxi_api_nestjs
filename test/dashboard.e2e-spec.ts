import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import request from 'supertest';
import { Repository } from 'typeorm';
import { AppModule } from '../src/app.module';
import { Category } from '../src/categories/entities/category.entity';
import { Client } from '../src/clients/entities/client.entity';
import { Order, OrderStatus } from '../src/orders/entities/order.entity';
import { Product } from '../src/products/entities/product.entity';
import { Role, User } from '../src/users/entities/user.entity';
import { configureApp } from './test-setup';

process.env.MOCK_AUTH_ENABLED = 'true';

const TABLES =
  'order_items, orders, inventory_reservations, cart_items, inventory, products, categories, clients, users';

const DAY_MS = 24 * 60 * 60 * 1000;
const diasAtras = (dias: number) => new Date(Date.now() - dias * DAY_MS);

interface StatsBody {
  data: {
    period: { days: number; previousFrom: string; from: string; to: string };
    revenue: { current: number; previous: number };
    orders: { current: number; previous: number };
    products: { active: number; current: number; previous: number };
    clients: { current: number; previous: number };
  };
}

describe('Dashboard (e2e)', () => {
  let app: INestApplication;
  let clients: Repository<Client>;
  let users: Repository<User>;
  let products: Repository<Product>;
  let categories: Repository<Category>;
  let orders: Repository<Order>;
  let clientId: string;
  let categoryId: string;

  const adminAuth = { Authorization: 'Bearer mock:clerk_admin_1' };
  const grocerAuth = { Authorization: 'Bearer mock:clerk_grocer_1' };

  /**
   * `created_at` is a @CreateDateColumn, so it is always "now" on insert.
   * Backdating it afterwards is the only way to place a row in a past window.
   */
  const backdate = async (
    table: string,
    id: string,
    createdAt: Date,
  ): Promise<void> => {
    await orders.query(`UPDATE ${table} SET created_at = $1 WHERE id = $2`, [
      createdAt,
      id,
    ]);
  };

  const seedOrder = async (opts: {
    total: string;
    createdAt: Date;
    status?: OrderStatus;
  }): Promise<Order> => {
    const order = await orders.save(
      orders.create({
        clientId,
        status: opts.status ?? OrderStatus.CONFIRMED,
        subtotal: opts.total,
        deliveryFee: '0',
        total: opts.total,
      }),
    );
    await backdate('orders', order.id, opts.createdAt);
    return order;
  };

  const seedProduct = async (opts: {
    sku: string;
    isActive: boolean;
    createdAt?: Date;
  }): Promise<Product> => {
    const product = await products.save(
      products.create({
        categoryId,
        sku: opts.sku,
        name: `Producto ${opts.sku}`,
        slug: `producto-${opts.sku}`,
        basePrice: '10.00',
        isActive: opts.isActive,
      }),
    );
    if (opts.createdAt) {
      await backdate('products', product.id, opts.createdAt);
    }
    return product;
  };

  const getStats = (query = ''): request.Test =>
    request(app.getHttpServer())
      .get(`/api/dashboard/stats${query}`)
      .set(adminAuth);

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
    orders = moduleRef.get(getRepositoryToken(Order));
  });

  beforeEach(async () => {
    await clients.query(`TRUNCATE TABLE ${TABLES} CASCADE`);

    const client = await clients.save(
      clients.create({ clerkId: 'clerk_client_1', email: 'c1@example.com' }),
    );
    clientId = client.id;

    await users.save(
      users.create({
        clerkId: 'clerk_admin_1',
        email: 'admin@example.com',
        role: Role.ADMIN,
        isActive: true,
      }),
    );
    await users.save(
      users.create({
        clerkId: 'clerk_grocer_1',
        email: 'grocer@example.com',
        role: Role.GROCER,
        isActive: true,
      }),
    );

    const category = await categories.save(
      categories.create({ name: 'Refrescos', slug: 'refrescos' }),
    );
    categoryId = category.id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('lo rechaza para un dependiente', async () => {
    await request(app.getHttpServer())
      .get('/api/dashboard/stats')
      .set(grocerAuth)
      .expect(403);
  });

  it('lo rechaza sin credenciales', async () => {
    await request(app.getHttpServer()).get('/api/dashboard/stats').expect(401);
  });

  it('cuenta los pedidos de la ventana y deja fuera los viejos', async () => {
    await seedOrder({ total: '100.00', createdAt: diasAtras(3) });
    await seedOrder({ total: '50.00', createdAt: diasAtras(20) });
    await seedOrder({ total: '999.00', createdAt: diasAtras(45) }); // ventana anterior
    await seedOrder({ total: '777.00', createdAt: diasAtras(120) }); // fuera de todo

    const { body } = (await getStats().expect(200)) as { body: StatsBody };

    expect(body.data.orders.current).toBe(2);
    expect(body.data.orders.previous).toBe(1);
    expect(body.data.revenue.current).toBe(150);
    expect(body.data.revenue.previous).toBe(999);
  });

  it('saca las canceladas de la facturación pero las cuenta como pedidos', async () => {
    await seedOrder({ total: '100.00', createdAt: diasAtras(3) });
    await seedOrder({
      total: '500.00',
      createdAt: diasAtras(3),
      status: OrderStatus.CANCELLED,
    });

    const { body } = (await getStats().expect(200)) as { body: StatsBody };

    expect(body.data.revenue.current).toBe(100);
    expect(body.data.orders.current).toBe(2);
  });

  it('ignora los pedidos borrados', async () => {
    const borrado = await seedOrder({
      total: '400.00',
      createdAt: diasAtras(3),
    });
    await orders.softDelete(borrado.id);

    const { body } = (await getStats().expect(200)) as { body: StatsBody };

    expect(body.data.orders.current).toBe(0);
    expect(body.data.revenue.current).toBe(0);
  });

  it('cuenta solo los productos activos, sin importar la ventana', async () => {
    await seedProduct({ sku: 'A1', isActive: true });
    await seedProduct({ sku: 'A2', isActive: true, createdAt: diasAtras(400) });
    await seedProduct({ sku: 'I1', isActive: false });

    const { body } = (await getStats().expect(200)) as { body: StatsBody };

    expect(body.data.products.active).toBe(2);
    expect(body.data.products.current).toBe(1); // solo el creado ahora
  });

  it('no cuenta como cliente nuevo una invitación sin aceptar', async () => {
    await clients.save(
      clients.create({
        clerkId: 'clerk_invitado',
        email: 'invitado@example.com',
        adminInvitePending: true,
      }),
    );

    const { body } = (await getStats().expect(200)) as { body: StatsBody };

    // Solo el cliente sembrado en beforeEach.
    expect(body.data.clients.current).toBe(1);
  });

  it('devuelve las cifras como números, no como texto', async () => {
    await seedOrder({ total: '1234.50', createdAt: diasAtras(1) });

    const { body } = (await getStats().expect(200)) as { body: StatsBody };

    expect(body.data.revenue.current).toBe(1234.5);
    expect(typeof body.data.revenue.current).toBe('number');
  });

  it('abre dos ventanas contiguas del mismo largo', async () => {
    const { body } = (await getStats().expect(200)) as { body: StatsBody };

    const { previousFrom, from, to, days } = body.data.period;
    expect(days).toBe(30);
    const largo = new Date(to).getTime() - new Date(from).getTime();
    const largoPrevio =
      new Date(from).getTime() - new Date(previousFrom).getTime();
    expect(largo).toBe(30 * DAY_MS);
    expect(largoPrevio).toBe(30 * DAY_MS);
  });

  it('acepta una ventana de 7 días', async () => {
    await seedOrder({ total: '10.00', createdAt: diasAtras(3) });
    await seedOrder({ total: '20.00', createdAt: diasAtras(10) });

    const { body } = (await getStats('?days=7').expect(200)) as {
      body: StatsBody;
    };

    expect(body.data.period.days).toBe(7);
    expect(body.data.orders.current).toBe(1);
    expect(body.data.orders.previous).toBe(1);
  });

  it('rechaza una ventana arbitraria', async () => {
    await getStats('?days=5').expect(400);
  });

  it('rechaza parámetros desconocidos', async () => {
    await getStats('?foo=1').expect(400);
  });
});
