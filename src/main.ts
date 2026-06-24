import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { json } from 'express';
import { IncomingMessage, ServerResponse } from 'http';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';
import { ConfigService } from '@nestjs/config';
import { CorsConfig } from './config/configuration';

interface RequestWithRawBody extends IncomingMessage {
  rawBody?: string;
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  const configService = app.get(ConfigService);

  // Capture the raw body so Clerk webhook signature verification can use the
  // exact bytes that were sent by Clerk.
  app.use(
    json({
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
}

void bootstrap();
