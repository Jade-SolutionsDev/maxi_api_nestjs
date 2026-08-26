/**
 * El proceso trabaja en UTC, pase lo que pase en la máquina que lo arranca.
 *
 * Las columnas de fecha son `timestamp without time zone` y la base guarda UTC.
 * Al leerlas, el driver construye la fecha interpretando ese texto **en la zona
 * del proceso**: en `America/Havana` las 14:59 UTC guardadas se convertían en
 * las 18:59 UTC, y la administración las mostraba cuatro horas adelantadas.
 *
 * Tiene que ir antes de cualquier import que pueda leer la hora.
 */
process.env.TZ = 'UTC';

import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { json } from 'express';
import helmet from 'helmet';
import { IncomingMessage, ServerResponse } from 'http';
import { DataSource } from 'typeorm';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { CorsConfig } from './config/configuration';
import { shouldExposeDocs } from './config/swagger.util';
import { Role, User } from './users/entities/user.entity';

/** Explicit JSON body ceiling (Express's default is 100kb, chosen by nobody). */
const JSON_BODY_LIMIT = '1mb';

interface RequestWithRawBody extends IncomingMessage {
  rawBody?: string;
}

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false,
  });
  const configService = app.get(ConfigService);

  // Trust the reverse proxy (Traefik) so req.ip is the real client from
  // X-Forwarded-For, not the proxy's address. Without this, rate limiting keys
  // every client to one bucket. Exact hop count is spoof-safe (MxH-0066).
  app.set('trust proxy', configService.get<number>('trustProxyHops') ?? 1);

  // Security headers. The API must be safe on its own, not rely on a proxy.
  // helmet() also strips X-Powered-By (its hidePoweredBy default).
  app.use(helmet());

  // Capture the raw body so Clerk webhook signature verification can use the
  // exact bytes that were sent by Clerk. Explicit size limit (see constant).
  app.use(
    json({
      limit: JSON_BODY_LIMIT,
      verify: (
        req: IncomingMessage,
        _res: ServerResponse<IncomingMessage>,
        buf: Buffer,
      ) => {
        (req as RequestWithRawBody).rawBody = buf.toString('utf8');
      },
    }),
  );

  app.useGlobalInterceptors(new ResponseInterceptor());
  app.useGlobalFilters(new AllExceptionsFilter());
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );

  app.setGlobalPrefix('api');

  // Swagger UI at /api/docs (JSON at /api/docs-json). Local development ONLY —
  // staging and production return 404 (the full API map is not for deployed envs).
  if (shouldExposeDocs(configService.get<string>('nodeEnv'))) {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('MaxiHabana API')
      .setDescription(
        'Backoffice + storefront API. Success responses are wrapped as ' +
          '`{ "data": ... }` and errors as `{ "error": { code, message } }` ' +
          'by global interceptors (not reflected in the schemas below).',
      )
      .setVersion('1.0')
      .addBearerAuth()
      .build();
    SwaggerModule.setup('api/docs', app, () =>
      SwaggerModule.createDocument(app, swaggerConfig),
    );
  }

  const cors = configService.get<CorsConfig>('cors') ?? {
    origins: [],
    credentials: false,
  };
  app.enableCors({
    origin: (
      origin: string | undefined,
      callback: (err: Error | null, allow?: boolean) => void,
    ) => {
      if (!origin || cors.origins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error(`Origin ${origin} not allowed by CORS`), false);
      }
    },
    credentials: cors.credentials,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });

  const port = configService.get<number>('port') || 3000;
  await app.listen(port);

  // One-off admin bootstrap: when PROMOTE_SUPERADMIN_CLERK_ID is set, ensure that
  // user is an active SUPER_ADMIN. Uses the internal DB connection (no external DB
  // access / allow-list needed). Idempotent and dormant while the env var is unset
  // — remove the var once the promotion shows in the logs.
  await maybePromoteSuperAdmin(app.get(DataSource));
}

async function maybePromoteSuperAdmin(dataSource: DataSource): Promise<void> {
  const clerkId = process.env.PROMOTE_SUPERADMIN_CLERK_ID?.trim();
  if (!clerkId) return;

  const logger = new Logger('PromoteSuperAdmin');
  try {
    const repo = dataSource.getRepository(User);
    const user = await repo.findOne({ where: { clerkId }, withDeleted: true });
    if (!user) {
      logger.warn(`No user with clerkId "${clerkId}"; nothing to promote.`);
      return;
    }
    if (user.role === Role.SUPER_ADMIN && user.isActive && !user.deletedAt) {
      logger.log(
        `"${user.email ?? clerkId}" is already an active SUPER_ADMIN.`,
      );
      return;
    }
    const before = user.role;
    user.role = Role.SUPER_ADMIN;
    user.isActive = true;
    user.deletedAt = null;
    await repo.save(user);
    logger.log(`Promoted "${user.email ?? clerkId}" ${before} -> SUPER_ADMIN.`);
  } catch (err) {
    // An admin convenience must never take down the live service.
    logger.error(
      'SUPER_ADMIN promotion failed',
      err instanceof Error ? err.stack : String(err),
    );
  }
}

void bootstrap();
