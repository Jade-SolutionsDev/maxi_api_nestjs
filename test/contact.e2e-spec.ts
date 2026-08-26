import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import request from 'supertest';
import { Repository } from 'typeorm';
import { AppModule } from '../src/app.module';
import { ContactMessage } from '../src/contact/entities/contact-message.entity';
import { Nomenclator } from '../src/nomenclators/entities/nomenclator.entity';
import { Role, User } from '../src/users/entities/user.entity';
import { configureApp } from './test-setup';

process.env.MOCK_AUTH_ENABLED = 'true';

const TABLES =
  'contact_replies, contact_messages, contact_reply_templates, users';

/**
 * Contact vertical: public form submission (anonymous, validated, honeypot)
 * and the permission-gated backoffice inbox with its reply log. The AddContact
 * migration runs at boot, which also validates it end to end.
 */
describe('Contacto (e2e)', () => {
  let app: INestApplication;
  let users: Repository<User>;
  let messages: Repository<ContactMessage>;
  let nomenclators: Repository<Nomenclator>;

  let motiveId: string;

  const adminAuth = { Authorization: 'Bearer mock:clerk_admin_1' };

  const envio = (extra: Record<string, unknown> = {}) => ({
    motiveId,
    message: 'Necesito ayuda con mi último pedido, por favor.',
    name: 'Ana',
    lastName: 'Pérez',
    email: 'ana@example.com',
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
    messages = moduleRef.get(getRepositoryToken(ContactMessage));
    nomenclators = moduleRef.get(getRepositoryToken(Nomenclator));
  });

  beforeEach(async () => {
    await users.query(`TRUNCATE TABLE ${TABLES} CASCADE`);
    // The nomenclators table keeps the migration-seeded motives, so it is not
    // truncated; drop only the rows this suite creates in earlier runs.
    await nomenclators.query(
      `DELETE FROM nomenclators WHERE code LIKE 'reclamaciones%'`,
    );
    await users.save(
      users.create({
        clerkId: 'clerk_admin_1',
        email: 'admin@example.com',
        role: Role.ADMIN,
        isActive: true,
      }),
    );

    // The migration seeds the motives; grab one instead of re-creating it.
    const motive = await nomenclators.findOne({
      where: { category: 'contact-motive', code: 'pedidos' },
    });
    motiveId = motive!.id;
  });

  afterAll(async () => {
    await users.query(`TRUNCATE TABLE ${TABLES} CASCADE`);
    await app.close();
  });

  it('lista los motivos públicos sembrados por la migración', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/public/contact/motives')
      .expect(200);

    const labels = res.body.data.map((m: { label: string }) => m.label);
    expect(labels).toContain('Pedidos');
    expect(labels).toContain('Otro');
  });

  it('acepta un envío anónimo válido y lo deja como nuevo', async () => {
    await request(app.getHttpServer())
      .post('/api/public/contact/messages')
      .send(envio())
      .expect(201);

    const row = await messages.findOne({
      where: { email: 'ana@example.com' },
    });
    expect(row).not.toBeNull();
    expect(row!.status).toBe('nuevo');
    expect(row!.clientId).toBeNull();
  });

  it('rechaza un envío anónimo sin email ni teléfono', async () => {
    await request(app.getHttpServer())
      .post('/api/public/contact/messages')
      .send(envio({ email: undefined, phone: undefined }))
      .expect(422);
  });

  it('rechaza un motivo desconocido', async () => {
    await request(app.getHttpServer())
      .post('/api/public/contact/messages')
      .send(envio({ motiveId: '00000000-0000-0000-0000-000000000099' }))
      .expect(400);
  });

  it('descarta en silencio el honeypot: responde 201 sin persistir', async () => {
    await request(app.getHttpServer())
      .post('/api/public/contact/messages')
      .send(envio({ website: 'http://spam.example' }))
      .expect(201);

    expect(await messages.count()).toBe(0);
  });

  it('no deja ver la bandeja sin sesión', async () => {
    await request(app.getHttpServer()).get('/api/contact/messages').expect(401);
  });

  it('la bandeja pagina, filtra por estado y expone el motivo', async () => {
    await request(app.getHttpServer())
      .post('/api/public/contact/messages')
      .send(envio())
      .expect(201);

    const res = await request(app.getHttpServer())
      .get('/api/contact/messages?status=nuevo')
      .set(adminAuth)
      .expect(200);

    expect(res.body.data.meta.total).toBe(1);
    expect(res.body.data.data[0].motiveLabel).toBe('Pedidos');
  });

  it('registrar una respuesta por whatsapp marca el mensaje respondido', async () => {
    await request(app.getHttpServer())
      .post('/api/public/contact/messages')
      .send(envio())
      .expect(201);
    const row = await messages.findOneOrFail({
      where: { email: 'ana@example.com' },
    });

    const res = await request(app.getHttpServer())
      .post(`/api/contact/messages/${row.id}/replies`)
      .set(adminAuth)
      .send({ channel: 'whatsapp', body: 'Hola Ana, ya lo revisamos.' })
      .expect(201);

    expect(res.body.data.status).toBe('respondido');
    expect(res.body.data.replies).toHaveLength(1);
    expect(res.body.data.replies[0].channel).toBe('whatsapp');
  });

  it('el canal plataforma responde 503 mientras Resend no esté configurado', async () => {
    await request(app.getHttpServer())
      .post('/api/public/contact/messages')
      .send(envio())
      .expect(201);
    const row = await messages.findOneOrFail({
      where: { email: 'ana@example.com' },
    });

    await request(app.getHttpServer())
      .post(`/api/contact/messages/${row.id}/replies`)
      .set(adminAuth)
      .send({ channel: 'plataforma', body: 'Respuesta por email.' })
      .expect(503);

    const fresh = await messages.findOneOrFail({ where: { id: row.id } });
    expect(fresh.status).toBe('nuevo');
  });

  it('CRUD de plantillas de respuesta', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/contact/templates')
      .set(adminAuth)
      .send({ title: 'Saludo', body: 'Hola, gracias por escribirnos.' })
      .expect(201);

    const id = created.body.data.id;

    await request(app.getHttpServer())
      .patch(`/api/contact/templates/${id}`)
      .set(adminAuth)
      .send({ title: 'Saludo inicial' })
      .expect(200);

    const list = await request(app.getHttpServer())
      .get('/api/contact/templates')
      .set(adminAuth)
      .expect(200);
    expect(list.body.data).toHaveLength(1);

    await request(app.getHttpServer())
      .delete(`/api/contact/templates/${id}`)
      .set(adminAuth)
      .expect(204);
  });

  it('el CRUD de nomencladores es solo para administradores', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/nomenclators')
      .set(adminAuth)
      .send({ category: 'contact-motive', label: 'Reclamaciones' })
      .expect(201);

    expect(created.body.data.code).toBe('reclamaciones');

    await request(app.getHttpServer())
      .get('/api/nomenclators?category=contact-motive')
      .expect(401);
  });
});
