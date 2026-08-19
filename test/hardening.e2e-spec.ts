import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from './test-setup';

describe('HTTP hardening (e2e)', () => {
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

  it('sets security headers and hides x-powered-by (helmet)', async () => {
    const res = await request(app.getHttpServer()).get('/api/health');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('rejects a request body over the size limit with 413', async () => {
    const huge = 'x'.repeat(2 * 1024 * 1024); // 2 MB > 1 MB limit
    await request(app.getHttpServer())
      .post('/api/users/storefront-mirror')
      .set('Content-Type', 'application/json')
      .send({ email: 'a@b.com', password: huge })
      .expect(413);
  });

  it('rejects an oversized pagination limit on public routes', async () => {
    await request(app.getHttpServer())
      .get('/api/public/products?limit=9999999')
      .expect(400);
  });
});
