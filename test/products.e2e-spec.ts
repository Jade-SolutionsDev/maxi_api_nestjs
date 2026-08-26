import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import request from 'supertest';
import { Repository } from 'typeorm';
import { AppModule } from '../src/app.module';
import { Category } from '../src/categories/entities/category.entity';
import { Client } from '../src/clients/entities/client.entity';
import { Inventory } from '../src/inventory/entities/inventory.entity';
import { Product } from '../src/products/entities/product.entity';
import { Role, User } from '../src/users/entities/user.entity';
import { configureApp } from './test-setup';

// Same mock-auth backend the cart and orders suites use: `mock:<clerkId>`
// resolves through AUTH_PROVIDER for both the backoffice and the storefront.
process.env.MOCK_AUTH_ENABLED = 'true';

const TABLES =
  'order_items, orders, inventory_reservations, cart_items, inventory, products, categories, clients, users';

/**
 * Covers MxH-0009 (backend CRUD) and the rules the admin screens rely on:
 * MxH-0012 (list), MxH-0013 (create), MxH-0014 (edit and delete).
 *
 * These endpoints had no e2e coverage at all, and all four cards sit in
 * Testing Failed.
 */
describe('Products (e2e)', () => {
  let app: INestApplication;
  let users: Repository<User>;
  let categories: Repository<Category>;
  let inventory: Repository<Inventory>;
  let clients: Repository<Client>;

  let departmentId: string;
  let categoryId: string;

  const adminAuth = { Authorization: 'Bearer mock:clerk_admin_1' };
  const locationId = '00000000-0000-0000-0000-000000000002';

  const nuevoProducto = (extra: Record<string, unknown> = {}) => ({
    categoryId,
    name: 'Cola 1L',
    imageUrl: 'https://example.com/cola.png',
    basePrice: 100,
    ...extra,
  });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication({ bodyParser: false });
    configureApp(app);
    await app.init();

    users = moduleRef.get(getRepositoryToken(User));
    categories = moduleRef.get(getRepositoryToken(Category));
    inventory = moduleRef.get(getRepositoryToken(Inventory));
    clients = moduleRef.get(getRepositoryToken(Client));
    void moduleRef.get(getRepositoryToken(Product));
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

    // A department is a Category with parentId = null; a category hangs off it.
    const department = await categories.save(
      categories.create({ name: 'Bebidas', slug: 'bebidas', parentId: null }),
    );
    departmentId = department.id;
    const category = await categories.save(
      categories.create({
        name: 'Refrescos',
        slug: 'refrescos',
        parentId: department.id,
      }),
    );
    categoryId = category.id;

    await users.query(
      `INSERT INTO stock_locations (id, name, is_active)
       VALUES ($1, 'E2E Storage', true) ON CONFLICT (id) DO NOTHING`,
      [locationId],
    );
  });

  afterAll(async () => {
    await users.query(`TRUNCATE TABLE ${TABLES} CASCADE`);
    await app.close();
  });

  const crear = (body: Record<string, unknown>) =>
    request(app.getHttpServer())
      .post('/api/products')
      .set(adminAuth)
      .send(body);

  describe('permisos', () => {
    it('no deja crear productos sin sesion', async () => {
      await request(app.getHttpServer())
        .post('/api/products')
        .send(nuevoProducto())
        .expect(401);
    });

    it('no deja listar productos sin sesion', async () => {
      await request(app.getHttpServer()).get('/api/products').expect(401);
    });
  });

  describe('crear: campos obligatorios', () => {
    it('rechaza un producto sin imagen', async () => {
      const { imageUrl, ...sinImagen } = nuevoProducto();
      await crear(sinImagen).expect(400);
    });

    it('rechaza un producto sin nombre', async () => {
      const { name, ...sinNombre } = nuevoProducto();
      await crear(sinNombre).expect(400);
    });

    it('rechaza un producto sin precio base', async () => {
      const { basePrice, ...sinPrecio } = nuevoProducto();
      await crear(sinPrecio).expect(400);
    });

    it('rechaza un producto sin categoria', async () => {
      const { categoryId: _omitida, ...sinCategoria } = nuevoProducto();
      await crear(sinCategoria).expect(400);
    });

    it('rechaza una rebaja mayor que 100', async () => {
      await crear(nuevoProducto({ discount: 101 })).expect(400);
    });

    it('rechaza una categoria que no existe', async () => {
      const res = await crear(
        nuevoProducto({ categoryId: '00000000-0000-4000-8000-000000000999' }),
      );
      expect([400, 404]).toContain(res.status);
    });
  });

  describe('el precio rebajado lo calcula el backend', () => {
    it('aplica el porcentaje sobre el precio base', async () => {
      const res = await crear(
        nuevoProducto({ basePrice: 100, discount: 25 }),
      ).expect(201);

      expect(res.body.data.basePrice).toBe(100);
      expect(res.body.data.discount).toBe(25);
      expect(res.body.data.finalPrice).toBe(75);
    });

    it('sin rebaja, el precio final es el precio base', async () => {
      const res = await crear(nuevoProducto({ basePrice: 42.5 })).expect(201);
      expect(res.body.data.finalPrice).toBe(42.5);
    });

    it('recalcula el precio final al cambiar la rebaja', async () => {
      const creado = await crear(
        nuevoProducto({ basePrice: 200, discount: 0 }),
      ).expect(201);

      const res = await request(app.getHttpServer())
        .patch(`/api/products/${creado.body.data.id}`)
        .set(adminAuth)
        .send({ discount: 50 })
        .expect(200);

      expect(res.body.data.finalPrice).toBe(100);
    });
  });

  describe('visibilidad en la tienda', () => {
    const publicos = () =>
      request(app.getHttpServer()).get('/api/public/products');

    it('un producto sin existencias no se ofrece al cliente', async () => {
      await crear(nuevoProducto()).expect(201);
      const res = await publicos().expect(200);
      expect(res.body.data.items).toHaveLength(0);
    });

    it('un producto con existencias si se ofrece', async () => {
      const creado = await crear(nuevoProducto()).expect(201);
      await inventory.save(
        inventory.create({
          locationId,
          productId: creado.body.data.id,
          quantity: 5,
        }),
      );

      const res = await publicos().expect(200);
      expect(res.body.data.items).toHaveLength(1);
      expect(res.body.data.items[0].name).toBe('Cola 1L');
    });

    it('un producto deshabilitado no se ofrece, aunque tenga existencias', async () => {
      const creado = await crear(nuevoProducto()).expect(201);
      await inventory.save(
        inventory.create({
          locationId,
          productId: creado.body.data.id,
          quantity: 5,
        }),
      );
      await request(app.getHttpServer())
        .patch(`/api/products/${creado.body.data.id}`)
        .set(adminAuth)
        .send({ isActive: false })
        .expect(200);

      const res = await publicos().expect(200);
      expect(res.body.data.items).toHaveLength(0);
    });

    it('la administracion si ve el producto deshabilitado', async () => {
      const creado = await crear(nuevoProducto({ isActive: false })).expect(
        201,
      );

      const res = await request(app.getHttpServer())
        .get('/api/products')
        .set(adminAuth)
        .expect(200);

      const ids = res.body.data.map((p: { id: string }) => p.id);
      expect(ids).toContain(creado.body.data.id);
    });
  });

  describe('listar', () => {
    it('devuelve los productos con su categoria, y el departamento dentro de ella', async () => {
      await crear(nuevoProducto()).expect(201);

      const res = await request(app.getHttpServer())
        .get('/api/products')
        .set(adminAuth)
        .expect(200);

      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].categoryId).toBe(categoryId);

      /**
       * OJO — esto documenta lo que hace hoy, no lo que pide la tarjeta.
       *
       * `MxH-0012 Listar productos` exige que el listado muestre departamento y
       * categoria. El servicio solo devuelve `categoryId`: `findAll` construye
       * la consulta sin cargar la relacion, asi que `category` llega vacio y
       * `departmentId` nulo. La administracion tiene que resolver los nombres
       * por su cuenta contra el catalogo.
       *
       * Si algun dia se arregla, estas dos aserciones fallaran — y eso sera la
       * senal de que hay que actualizarlas, no de que algo se rompio.
       */
      expect(res.body.data[0].category).toBeUndefined();
      expect(res.body.data[0].departmentId).toBeNull();
    });

    it('encuentra por nombre aunque la tilde no coincida', async () => {
      /**
       * En español casi todo lo buscado la lleva y casi nadie la escribe. Antes
       * un `ILIKE` crudo devolvia cero para «almibar» teniendo «Almíbar»
       * guardado, y quien buscaba concluia que el producto no existia.
       */
      await crear(nuevoProducto({ name: 'Melocotón en Almíbar' })).expect(201);

      const sinTilde = await request(app.getHttpServer())
        .get('/api/products?q=melocoton')
        .set(adminAuth)
        .expect(200);
      expect(sinTilde.body.data).toHaveLength(1);

      const conTilde = await request(app.getHttpServer())
        .get('/api/products?q=Almíbar')
        .set(adminAuth)
        .expect(200);
      expect(conTilde.body.data).toHaveLength(1);

      const otraCosa = await request(app.getHttpServer())
        .get('/api/products?q=zzz')
        .set(adminAuth)
        .expect(200);
      expect(otraCosa.body.data).toHaveLength(0);
    });

    it('el detalle si trae departmentId, para el formulario de edicion', async () => {
      const creado = await crear(nuevoProducto()).expect(201);

      const res = await request(app.getHttpServer())
        .get(`/api/products/${creado.body.data.id}`)
        .set(adminAuth)
        .expect(200);

      expect(res.body.data.departmentId).toBe(departmentId);
    });
  });

  describe('eliminar', () => {
    it('borra del todo un producto que nunca se vendio', async () => {
      const creado = await crear(nuevoProducto()).expect(201);

      await request(app.getHttpServer())
        .delete(`/api/products/${creado.body.data.id}`)
        .set(adminAuth)
        .expect(200);

      const res = await request(app.getHttpServer())
        .get('/api/products')
        .set(adminAuth)
        .expect(200);
      expect(res.body.data).toHaveLength(0);
    });

    it('se niega a borrar un producto que aun tiene existencias', async () => {
      const creado = await crear(nuevoProducto()).expect(201);
      await inventory.save(
        inventory.create({
          locationId,
          productId: creado.body.data.id,
          quantity: 5,
        }),
      );

      // Regla del servicio, ausente de los criterios de MxH-0009: el stock debe
      // quedar a cero antes de borrar, para que el inventario siga cuadrando.
      await request(app.getHttpServer())
        .delete(`/api/products/${creado.body.data.id}`)
        .set(adminAuth)
        .expect(409);
    });

    it('conserva un producto ya vendido y deja de ofrecerlo', async () => {
      const creado = await crear(nuevoProducto()).expect(201);
      const productId = creado.body.data.id;

      const client = await clients.save(
        clients.create({ clerkId: 'clerk_client_1', email: 'c1@example.com' }),
      );
      const [order] = await users.query(
        `INSERT INTO orders (client_id, order_number, status, payment_status, subtotal, delivery_fee, total)
         VALUES ($1, 1001, 'pending', 'pending', 100, 0, 100) RETURNING id`,
        [client.id],
      );
      await users.query(
        `INSERT INTO order_items (order_id, product_id, product_name_snapshot, quantity, unit_price, line_total)
         VALUES ($1, $2, 'Cola 1L', 1, 100, 100)`,
        [order.id, productId],
      );

      await request(app.getHttpServer())
        .delete(`/api/products/${productId}`)
        .set(adminAuth)
        .expect(200);

      // La linea del pedido sobrevive: la trazabilidad no se pierde.
      const [{ count }] = await users.query(
        'SELECT count(*)::int AS count FROM order_items WHERE product_id = $1',
        [productId],
      );
      expect(count).toBe(1);

      const publico = await request(app.getHttpServer())
        .get('/api/public/products')
        .expect(200);
      expect(publico.body.data.items).toHaveLength(0);
    });
  });
});
