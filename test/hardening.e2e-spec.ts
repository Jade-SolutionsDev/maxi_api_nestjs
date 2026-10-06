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

  /**
   * MxH-0159. Un id que no es un UUID entraba sin validar hasta Postgres
   * —«invalid input syntax for type uuid»— y las tres rutas públicas de ficha
   * respondían **500**. Un 500 en una ruta pública no es solo una respuesta
   * fea: es ruido en la vigilancia y le dice a un buscador que el problema es
   * nuestro y que vuelva más tarde.
   *
   * No lo veía nadie desde la tienda: extrae el UUID del final del slug y si no
   * lo hay no llega a llamar. Lo veían los bots y quien escribe la dirección a
   * mano.
   */
  it.each([
    ['/api/public/products'],
    ['/api/public/categories'],
    ['/api/public/departments'],
  ])('answers 400, not 500, to a malformed id on %s', async (ruta) => {
    await request(app.getHttpServer()).get(`${ruta}/no-soy-un-uuid`).expect(400);
  });

  // Control del de arriba: un UUID bien formado que no existe sigue dando 404.
  // Sin esto, un 400 para todo también pasaría la prueba.
  it('still answers 404 to a well-formed id that does not exist', async () => {
    await request(app.getHttpServer())
      .get('/api/public/products/00000000-0000-4000-8000-000000000000')
      .expect(404);
  });
});
