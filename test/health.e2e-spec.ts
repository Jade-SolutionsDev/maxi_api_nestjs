import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { configureApp } from './test-setup';

interface HealthResponseBody {
  data?: {
    status: string;
    timestamp?: string;
  };
  error?: {
    code: string;
    message: string;
  };
}

describe('HealthController (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();
  });

  it('/api/health (GET) returns a wrapped ok payload', () => {
    return request(app.getHttpServer())
      .get('/api/health')
      .expect(200)
      .expect((response: { body: HealthResponseBody }) => {
        const { body } = response;
        expect(body.data).toEqual(expect.objectContaining({ status: 'ok' }));
        expect(body.data?.timestamp).toBeDefined();
      });
  });

  it('/api/health/ready (GET) returns a wrapped ready payload', () => {
    return request(app.getHttpServer())
      .get('/api/health/ready')
      .expect(200)
      .expect((response: { body: HealthResponseBody }) => {
        const { body } = response;
        expect(body.data).toEqual(expect.objectContaining({ status: 'ready' }));
      });
  });

  it('unknown routes return the standard error envelope', () => {
    return request(app.getHttpServer())
      .get('/does-not-exist')
      .expect(404)
      .expect((response: { body: HealthResponseBody }) => {
        const { body } = response;
        expect(body.error?.code).toBe('NotFoundException');
        expect(body.error?.message).toContain('Cannot GET /does-not-exist');
      });
  });

  afterEach(async () => {
    await app.close();
  });
});
