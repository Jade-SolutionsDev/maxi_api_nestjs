import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import request from 'supertest';
import { Repository } from 'typeorm';
import { AppModule } from '../src/app.module';
import { Category } from '../src/categories/entities/category.entity';
import { Product } from '../src/products/entities/product.entity';
import { Role, User } from '../src/users/entities/user.entity';
import { configureApp } from './test-setup';

process.env.MOCK_AUTH_ENABLED = 'true';

const TABLES =
  'order_items, orders, inventory_reservations, cart_items, inventory_operation_items, inventory_operations, inventory, products, categories, clients, stock_location_coverage, stock_locations, users';

/**
 * Storages and the movement engine behind them.
 *
 * MxH-0025 (list storages) and MxH-0023 (general inventory listing) are in
 * Testing Failed, and neither module had e2e coverage. What is tested here is
 * the part that must never be wrong: stock only moves through operations, and
 * every movement leaves a trace.
 */
describe('Inventory and storages (e2e)', () => {
  let app: INestApplication;
  let users: Repository<User>;
  let categories: Repository<Category>;
  let products: Repository<Product>;

  let productId: string;
  let provinceId: string;
  const adminAuth = { Authorization: 'Bearer mock:clerk_admin_1' };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication({ bodyParser: false });
    configureApp(app);
    await app.init();
    users = moduleRef.get(getRepositoryToken(User));
    categories = moduleRef.get(getRepositoryToken(Category));
    products = moduleRef.get(getRepositoryToken(Product));
  });

  beforeEach(async () => {
    await users.query(`TRUNCATE TABLE ${TABLES} CASCADE`);
    await users.save(
      users.create({
        clerkId: 'clerk_admin_1',
        email: 'admin@example.com',
        role: Role.ADMIN,
        isActive: true,
      }),
    );
    const dep = await categories.save(
      categories.create({ name: 'Bebidas', slug: 'bebidas', parentId: null }),
    );
    const cat = await categories.save(
      categories.create({
        name: 'Refrescos',
        slug: 'refrescos',
        parentId: dep.id,
      }),
    );
    const product = await products.save(
      products.create({
        categoryId: cat.id,
        sku: 'COLA-1L',
        name: 'Cola 1L',
        slug: 'cola-1l',
        measureUnit: 'unidad',
        basePrice: '10.00',
        discount: '0.00',
      }),
    );
    productId = product.id;

    // Un almacen necesita al menos una zona de cobertura, y la provincia tiene
    // que existir: la geografia la siembra la aplicacion al arrancar.
    const [provincia] = await users.query(
      'SELECT id FROM provinces ORDER BY name LIMIT 1',
    );
    provinceId = provincia.id;
  });

  afterAll(async () => {
    await users.query(`TRUNCATE TABLE ${TABLES} CASCADE`);
    await app.close();
  });

  const crearAlmacen = (name: string) =>
    request(app.getHttpServer())
      .post('/api/stock-locations')
      .set(adminAuth)
      .send({
        name,
        coverage: [{ coverageType: 'province', provinceId }],
      });

  const operar = (body: Record<string, unknown>) =>
    request(app.getHttpServer())
      .post('/api/inventory/operations')
      .set(adminAuth)
      .send(body);

  const existencias = async (locationId: string) => {
    const res = await request(app.getHttpServer())
      .get(`/api/inventory?locationId=${locationId}`)
      .set(adminAuth)
      .expect(200);
    const filas = res.body.data.items ?? res.body.data;
    const fila = filas.find(
      (r: { productId: string }) => r.productId === productId,
    );
    return fila?.quantity ?? 0;
  };

  describe('almacenes', () => {
    it('no deja listar almacenes sin sesion', async () => {
      await request(app.getHttpServer())
        .get('/api/stock-locations')
        .expect(401);
    });

    it('rechaza un almacen sin nombre', async () => {
      await request(app.getHttpServer())
        .post('/api/stock-locations')
        .set(adminAuth)
        .send({ coverage: [{ coverageType: 'province', provinceId }] })
        .expect(400);
    });

    it('rechaza un almacen sin zona de cobertura', async () => {
      await request(app.getHttpServer())
        .post('/api/stock-locations')
        .set(adminAuth)
        .send({ name: 'Sin cobertura' })
        .expect(400);
    });

    it('crea un almacen y lo devuelve en el listado', async () => {
      const creado = await crearAlmacen('Almacen Central').expect(201);
      expect(creado.body.data.name).toBe('Almacen Central');

      const res = await request(app.getHttpServer())
        .get('/api/stock-locations')
        .set(adminAuth)
        .expect(200);
      const nombres = (res.body.data.items ?? res.body.data).map(
        (l: { name: string }) => l.name,
      );
      expect(nombres).toContain('Almacen Central');
    });

    it('permite desactivar un almacen', async () => {
      const creado = await crearAlmacen('Temporal').expect(201);

      const res = await request(app.getHttpServer())
        .patch(`/api/stock-locations/${creado.body.data.id}`)
        .set(adminAuth)
        .send({ isActive: false })
        .expect(200);

      expect(res.body.data.isActive).toBe(false);
    });
  });

  describe('el motor de movimientos', () => {
    let locationId: string;

    beforeEach(async () => {
      const almacen = await crearAlmacen('Almacen Central').expect(201);
      locationId = almacen.body.data.id;
    });

    it('una entrada suma existencias', async () => {
      await operar({
        locationId,
        type: 'IN',
        items: [{ productId, quantity: 10 }],
      }).expect(201);

      expect(await existencias(locationId)).toBe(10);
    });

    it('una salida resta existencias', async () => {
      await operar({
        locationId,
        type: 'IN',
        items: [{ productId, quantity: 10 }],
      }).expect(201);
      await operar({
        locationId,
        type: 'OUT',
        items: [{ productId, quantity: 4 }],
      }).expect(201);

      expect(await existencias(locationId)).toBe(6);
    });

    it('no deja sacar mas de lo que hay', async () => {
      await operar({
        locationId,
        type: 'IN',
        items: [{ productId, quantity: 3 }],
      }).expect(201);

      const res = await operar({
        locationId,
        type: 'OUT',
        items: [{ productId, quantity: 5 }],
      });
      expect([400, 409]).toContain(res.status);
      // Y las existencias no se tocan.
      expect(await existencias(locationId)).toBe(3);
    });

    it('rechaza una cantidad de cero', async () => {
      await operar({
        locationId,
        type: 'IN',
        items: [{ productId, quantity: 0 }],
      }).expect(400);
    });

    it('rechaza una operacion sin lineas', async () => {
      await operar({ locationId, type: 'IN', items: [] }).expect(400);
    });

    it('una transferencia mueve el stock de un almacen a otro', async () => {
      const destino = await crearAlmacen('Almacen Vedado').expect(201);
      const targetLocationId = destino.body.data.id;

      await operar({
        locationId,
        type: 'IN',
        items: [{ productId, quantity: 10 }],
      }).expect(201);
      await operar({
        locationId,
        type: 'TRANSFER',
        targetLocationId,
        items: [{ productId, quantity: 4 }],
      }).expect(201);

      expect(await existencias(locationId)).toBe(6);
      expect(await existencias(targetLocationId)).toBe(4);
    });

    it('una transferencia sin destino no se acepta', async () => {
      await operar({
        locationId,
        type: 'IN',
        items: [{ productId, quantity: 5 }],
      }).expect(201);

      const res = await operar({
        locationId,
        type: 'TRANSFER',
        items: [{ productId, quantity: 2 }],
      });
      expect([400, 409]).toContain(res.status);
    });

    it('cada movimiento queda registrado en el historial del producto', async () => {
      await operar({
        locationId,
        type: 'IN',
        items: [{ productId, quantity: 10 }],
        note: 'compra inicial',
      }).expect(201);
      await operar({
        locationId,
        type: 'OUT',
        items: [{ productId, quantity: 2 }],
      }).expect(201);

      const res = await request(app.getHttpServer())
        .get(`/api/inventory/product/${productId}/history`)
        .set(adminAuth)
        .expect(200);

      const movimientos = res.body.data.items ?? res.body.data;
      expect(movimientos.length).toBeGreaterThanOrEqual(2);
    });

    it('el agregado suma las existencias de todos los almacenes', async () => {
      const otro = await crearAlmacen('Almacen Vedado').expect(201);
      await operar({
        locationId,
        type: 'IN',
        items: [{ productId, quantity: 10 }],
      }).expect(201);
      await operar({
        locationId: otro.body.data.id,
        type: 'IN',
        items: [{ productId, quantity: 5 }],
      }).expect(201);

      const res = await request(app.getHttpServer())
        .get('/api/inventory/aggregate')
        .set(adminAuth)
        .expect(200);

      // El agregado va por producto: su `id` ES el producto, y ya trae las
      // existencias sumadas de todos los almacenes.
      const filas = res.body.data.items ?? res.body.data;
      const fila = filas.find((r: { id: string }) => r.id === productId);
      expect(fila).toBeDefined();

      expect(fila.real).toBe(15);
      expect(fila.available).toBe(15);
      expect(fila.reserved).toBe(0);
      expect(fila.storageCount).toBe(2);
    });
  });
});
