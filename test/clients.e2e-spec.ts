import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { sign } from 'jsonwebtoken';
import request from 'supertest';
import { Repository } from 'typeorm';
import { AppModule } from '../src/app.module';
import { Client } from '../src/clients/entities/client.entity';
import { Role, User } from '../src/users/entities/user.entity';
import { configureApp } from './test-setup';

process.env.CLERK_SECRET_KEY = '';
process.env.CLERK_BACKOFFICE_SECRET_KEY = '';
process.env.CLERK_JWT_SECRET = 'dev-secret';

/**
 * El listado de clientes es el único de la administración que crece sin techo:
 * no lo llena quien administra, lo llenan los que compran. Estas pruebas van
 * contra Postgres de verdad a propósito — las columnas `firstName`/`lastName`
 * de esta tabla van en camelCase entrecomillado, al revés que el resto del
 * esquema, y `f_unaccent` solo existe en la base. Un doble simulado habría
 * dicho que todo está bien.
 */
describe('ClientsController · listado (e2e)', () => {
  let app: INestApplication;
  let clients: Repository<Client>;
  let users: Repository<User>;
  let token: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication({ bodyParser: false });
    configureApp(app);
    await app.init();

    clients = moduleRef.get(getRepositoryToken(Client));
    users = moduleRef.get(getRepositoryToken(User));
  });

  beforeEach(async () => {
    await clients.query('TRUNCATE TABLE clients CASCADE');
    await users.query('TRUNCATE TABLE users CASCADE');

    const admin = await users.save(
      users.create({
        firstName: 'Admin',
        lastName: 'User',
        email: 'admin@example.com',
        role: Role.ADMIN,
        isActive: true,
        clerkId: 'clerk_admin_clients',
      }),
    );
    token = sign({ sub: admin.clerkId }, 'dev-secret');

    await clients.save([
      clients.create({
        clerkId: 'c1',
        email: 'aurelio@example.com',
        firstName: 'Aurelio',
        lastName: 'Bermúdez',
        phone: '55512345',
        isActive: true,
      }),
      clients.create({
        clerkId: 'c2',
        email: 'bernarda@example.com',
        firstName: 'Bernarda',
        lastName: 'Solís',
        isActive: false,
      }),
      clients.create({
        clerkId: 'c3',
        email: 'casilda@example.com',
        firstName: 'Casilda',
        lastName: 'Ruiz',
        isActive: true,
      }),
    ]);
  });

  afterAll(async () => {
    await clients.query('TRUNCATE TABLE clients CASCADE');
    await users.query('TRUNCATE TABLE users CASCADE');
    await app.close();
  });

  const listar = async (query = '') => {
    const res = await request(app.getHttpServer())
      .get(`/api/clients${query}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    // Doble envoltorio: la respuesta paginada viaja dentro del `data` que el
    // interceptor global le pone a todo. Es la misma forma que espera la
    // administración, y la misma que lee `users.e2e-spec.ts`.
    return res.body.data as {
      data: { id: string; firstName: string; email: string }[];
      meta: { total: number; page: number; limit: number; totalPages: number };
    };
  };

  it('sin filtros devuelve todos, con su total', async () => {
    const body = await listar();

    expect(body.data).toHaveLength(3);
    expect(body.meta.total).toBe(3);
  });

  it('busca por el nombre', async () => {
    const body = await listar('?q=Aurelio');

    expect(body.data).toHaveLength(1);
    expect(body.data[0].firstName).toBe('Aurelio');
  });

  it('busca por el correo', async () => {
    const body = await listar('?q=casilda@example');

    expect(body.data.map((c) => c.firstName)).toEqual(['Casilda']);
  });

  it('busca por el teléfono', async () => {
    const body = await listar('?q=5551');

    expect(body.data.map((c) => c.firstName)).toEqual(['Aurelio']);
  });

  // «Bermudez» tiene que encontrar «Bermúdez»: quien escribe en el buscador
  // rara vez pone la tilde.
  it('encuentra un apellido con tilde escribiéndolo sin ella', async () => {
    const body = await listar('?q=bermudez');

    expect(body.data.map((c) => c.firstName)).toEqual(['Aurelio']);
  });

  it('no distingue mayúsculas', async () => {
    const body = await listar('?q=AURELIO');

    expect(body.data).toHaveLength(1);
  });

  it('filtra por estado', async () => {
    const body = await listar('?isActive=false');

    expect(body.data.map((c) => c.firstName)).toEqual(['Bernarda']);
  });

  it('parte en páginas y dice cuántas hay', async () => {
    const primera = await listar('?page=1&limit=2');
    const segunda = await listar('?page=2&limit=2');

    expect(primera.data).toHaveLength(2);
    expect(segunda.data).toHaveLength(1);
    expect(primera.meta.totalPages).toBe(2);
    expect([...primera.data, ...segunda.data].map((c) => c.email)).toHaveLength(
      3,
    );
  });

  it('ordena por el campo que se le pida', async () => {
    const body = await listar('?sortBy=firstName&sortOrder=asc');

    expect(body.data.map((c) => c.firstName)).toEqual([
      'Aurelio',
      'Bernarda',
      'Casilda',
    ]);
  });

  /**
   * Sin esto, la administración no puede pintar el cliente de un pedido en
   * cuanto ese cliente deja de caer en la primera página.
   */
  it('resuelve clientes sueltos por su identificador', async () => {
    const todos = await listar();
    const dos = todos.data.slice(0, 2);

    const body = await listar(`?id=${dos.map((c) => c.id).join(',')}`);

    expect(body.data).toHaveLength(2);
  });

  it('sigue exigiendo sesión de administración', async () => {
    await request(app.getHttpServer()).get('/api/clients').expect(401);
  });
});
