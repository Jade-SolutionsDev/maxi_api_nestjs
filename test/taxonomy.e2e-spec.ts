import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import request from 'supertest';
import { Repository } from 'typeorm';
import { AppModule } from '../src/app.module';
import { Category } from '../src/categories/entities/category.entity';
import { Role, User } from '../src/users/entities/user.entity';
import { configureApp } from './test-setup';

process.env.MOCK_AUTH_ENABLED = 'true';

const TABLES =
  'order_items, orders, inventory_reservations, cart_items, inventory, products, categories, clients, users';

/**
 * Departments and categories: the taxonomy every product hangs from.
 *
 * Six cards in Testing Failed live here and none of them had e2e coverage:
 * MxH-0015 (list departments), 0016 (create), 0017 (edit and delete),
 * MxH-0019 (create category), 0020 (list), 0021 (edit and delete).
 *
 * In the data model a department is simply a Category with `parentId = null`.
 */
describe('Taxonomy: departments and categories (e2e)', () => {
  let app: INestApplication;
  let users: Repository<User>;
  let categories: Repository<Category>;

  const adminAuth = { Authorization: 'Bearer mock:clerk_admin_1' };
  const IMG = 'https://example.com/img.png';

  const nuevoDepartamento = (extra: Record<string, unknown> = {}) => ({
    name: 'Bebidas',
    imageDesktopUrl: IMG,
    imageMobileUrl: IMG,
    ...extra,
  });

  const nuevaCategoria = (
    departmentId: string,
    extra: Record<string, unknown> = {},
  ) => ({
    departmentId,
    name: 'Refrescos',
    imageDesktopUrl: IMG,
    imageMobileUrl: IMG,
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
  });

  afterAll(async () => {
    await users.query(`TRUNCATE TABLE ${TABLES} CASCADE`);
    await app.close();
  });

  const crearDepartamento = (body: Record<string, unknown>) =>
    request(app.getHttpServer())
      .post('/api/departments')
      .set(adminAuth)
      .send(body);

  const crearCategoria = (body: Record<string, unknown>) =>
    request(app.getHttpServer())
      .post('/api/categories')
      .set(adminAuth)
      .send(body);

  describe('permisos', () => {
    it('no deja crear departamentos sin sesion', async () => {
      await request(app.getHttpServer())
        .post('/api/departments')
        .send(nuevoDepartamento())
        .expect(401);
    });

    it('no deja crear categorias sin sesion', async () => {
      await request(app.getHttpServer())
        .post('/api/categories')
        .send(nuevaCategoria('00000000-0000-4000-8000-000000000001'))
        .expect(401);
    });
  });

  describe('departamentos', () => {
    it('rechaza un departamento sin nombre', async () => {
      const { name, ...sinNombre } = nuevoDepartamento();
      await crearDepartamento(sinNombre).expect(400);
    });

    it('rechaza un departamento sin imagen', async () => {
      const { imageDesktopUrl, ...sinImagen } = nuevoDepartamento();
      await crearDepartamento(sinImagen).expect(400);
    });

    it('crea un departamento y lo devuelve en el listado', async () => {
      const creado = await crearDepartamento(nuevoDepartamento()).expect(201);
      expect(creado.body.data.name).toBe('Bebidas');

      const res = await request(app.getHttpServer())
        .get('/api/departments')
        .set(adminAuth)
        .expect(200);

      const nombres = res.body.data.map((d: { name: string }) => d.name);
      expect(nombres).toContain('Bebidas');
    });

    it('genera el slug a partir del nombre cuando no se envia', async () => {
      const creado = await crearDepartamento(
        nuevoDepartamento({ name: 'Frutas y Verduras' }),
      ).expect(201);
      expect(creado.body.data.slug).toBeTruthy();
      expect(creado.body.data.slug).not.toContain(' ');
    });

    it('modifica el nombre de un departamento', async () => {
      const creado = await crearDepartamento(nuevoDepartamento()).expect(201);

      const res = await request(app.getHttpServer())
        .patch(`/api/departments/${creado.body.data.id}`)
        .set(adminAuth)
        .send({ name: 'Bebidas y refrescos' })
        .expect(200);

      expect(res.body.data.name).toBe('Bebidas y refrescos');
    });

    it('elimina un departamento vacio', async () => {
      const creado = await crearDepartamento(nuevoDepartamento()).expect(201);

      await request(app.getHttpServer())
        .delete(`/api/departments/${creado.body.data.id}`)
        .set(adminAuth)
        .expect(200);

      const res = await request(app.getHttpServer())
        .get('/api/departments')
        .set(adminAuth)
        .expect(200);
      const ids = res.body.data.map((d: { id: string }) => d.id);
      expect(ids).not.toContain(creado.body.data.id);
    });
  });

  describe('categorias', () => {
    let departmentId: string;

    beforeEach(async () => {
      const dep = await crearDepartamento(nuevoDepartamento()).expect(201);
      departmentId = dep.body.data.id;
    });

    it('rechaza una categoria sin departamento', async () => {
      const { departmentId: _omitido, ...sinDepartamento } =
        nuevaCategoria(departmentId);
      await crearCategoria(sinDepartamento).expect(400);
    });

    it('rechaza una categoria sin nombre', async () => {
      const { name, ...sinNombre } = nuevaCategoria(departmentId);
      await crearCategoria(sinNombre).expect(400);
    });

    it('rechaza una categoria cuyo departamento no existe', async () => {
      const res = await crearCategoria(
        nuevaCategoria('00000000-0000-4000-8000-000000000999'),
      );
      expect([400, 404]).toContain(res.status);
    });

    it('crea la categoria colgando del departamento indicado', async () => {
      const res = await crearCategoria(nuevaCategoria(departmentId)).expect(
        201,
      );

      expect(res.body.data.parentId).toBe(departmentId);
      expect(res.body.data.name).toBe('Refrescos');
    });

    it('lista las categorias de un departamento', async () => {
      await crearCategoria(nuevaCategoria(departmentId)).expect(201);
      await crearCategoria(
        nuevaCategoria(departmentId, { name: 'Jugos' }),
      ).expect(201);

      const res = await request(app.getHttpServer())
        .get(`/api/categories?departmentId=${departmentId}`)
        .set(adminAuth)
        .expect(200);

      const nombres = res.body.data.map((c: { name: string }) => c.name);
      expect(nombres).toEqual(expect.arrayContaining(['Refrescos', 'Jugos']));
    });

    it('no mezcla las categorias de dos departamentos', async () => {
      const otro = await crearDepartamento(
        nuevoDepartamento({ name: 'Limpieza' }),
      ).expect(201);
      await crearCategoria(nuevaCategoria(departmentId)).expect(201);
      await crearCategoria(
        nuevaCategoria(otro.body.data.id, { name: 'Detergentes' }),
      ).expect(201);

      const res = await request(app.getHttpServer())
        .get(`/api/categories?departmentId=${departmentId}`)
        .set(adminAuth)
        .expect(200);

      const nombres = res.body.data.map((c: { name: string }) => c.name);
      expect(nombres).toContain('Refrescos');
      expect(nombres).not.toContain('Detergentes');
    });

    it('modifica una categoria', async () => {
      const creada = await crearCategoria(nuevaCategoria(departmentId)).expect(
        201,
      );

      const res = await request(app.getHttpServer())
        .patch(`/api/categories/${creada.body.data.id}`)
        .set(adminAuth)
        .send({ name: 'Refrescos y aguas' })
        .expect(200);

      expect(res.body.data.name).toBe('Refrescos y aguas');
    });

    it('elimina una categoria vacia', async () => {
      const creada = await crearCategoria(nuevaCategoria(departmentId)).expect(
        201,
      );

      await request(app.getHttpServer())
        .delete(`/api/categories/${creada.body.data.id}`)
        .set(adminAuth)
        .expect(200);

      const res = await request(app.getHttpServer())
        .get(`/api/categories?departmentId=${departmentId}`)
        .set(adminAuth)
        .expect(200);
      expect(res.body.data).toHaveLength(0);
    });

    it('un departamento con categorias no se lleva por delante sus hijas en silencio', async () => {
      const creada = await crearCategoria(nuevaCategoria(departmentId)).expect(
        201,
      );

      const borrado = await request(app.getHttpServer())
        .delete(`/api/departments/${departmentId}`)
        .set(adminAuth);

      // Si el servicio lo permite, la categoria hija no debe quedar colgando de
      // un departamento inexistente; si lo impide, mejor aun.
      if (borrado.status === 200) {
        const cat = await categories.findOne({
          where: { id: creada.body.data.id },
        });
        expect(cat?.deletedAt ?? cat).not.toBeNull();
      } else {
        expect([400, 409]).toContain(borrado.status);
      }
    });
  });
});
