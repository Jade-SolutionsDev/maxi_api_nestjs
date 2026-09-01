import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from './test-setup';

// No storefront Clerk secret → client token verification always fails, so every
// call here is a rejection. That is the property under test: saved addresses
// are never reachable without a customer session, and the endpoint never leaks
// whether a given address exists.
process.env.CLERK_SECRET_KEY = '';
process.env.CLERK_BACKOFFICE_SECRET_KEY = '';

const SOME_UUID = '00000000-0000-4000-8000-000000000000';

describe('ClientAddressesController (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication({ bodyParser: false });
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  const routes: [string, () => request.Test][] = [
    [
      'GET /storefront/addresses',
      () => request(app.getHttpServer()).get('/api/storefront/addresses'),
    ],
    [
      'POST /storefront/addresses',
      () =>
        request(app.getHttpServer())
          .post('/api/storefront/addresses')
          .send({ street: 'Calle 23', municipalityId: SOME_UUID }),
    ],
    [
      'GET /storefront/addresses/:id',
      () =>
        request(app.getHttpServer()).get(
          `/api/storefront/addresses/${SOME_UUID}`,
        ),
    ],
    [
      'PATCH /storefront/addresses/:id',
      () =>
        request(app.getHttpServer())
          .patch(`/api/storefront/addresses/${SOME_UUID}`)
          .send({ street: 'Calle 25' }),
    ],
    [
      'PATCH /storefront/addresses/:id/default',
      () =>
        request(app.getHttpServer()).patch(
          `/api/storefront/addresses/${SOME_UUID}/default`,
        ),
    ],
    [
      'DELETE /storefront/addresses/:id',
      () =>
        request(app.getHttpServer()).delete(
          `/api/storefront/addresses/${SOME_UUID}`,
        ),
    ],
  ];

  it.each(routes)('%s rejects an anonymous caller', async (_name, call) => {
    await call().expect(401);
  });

  it('rejects a bearer token that is not a valid customer session', async () => {
    await request(app.getHttpServer())
      .get('/api/storefront/addresses')
      .set('Authorization', 'Bearer not-a-real-token')
      .expect(401);
  });

  it('never answers 403, which would confirm the address exists', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/storefront/addresses/${SOME_UUID}`)
      .set('Authorization', 'Bearer not-a-real-token');

    expect(res.status).toBe(401);
    expect(res.status).not.toBe(403);
  });
});
