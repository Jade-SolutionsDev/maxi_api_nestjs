import { INestApplication, ValidationPipe } from '@nestjs/common';
import { json } from 'express';
import { IncomingMessage, ServerResponse } from 'http';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { ResponseInterceptor } from '../src/common/interceptors/response.interceptor';

interface RequestWithRawBody extends IncomingMessage {
  rawBody?: string;
}

export function configureApp(app: INestApplication): void {
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

  app.setGlobalPrefix('api');
  app.useGlobalInterceptors(new ResponseInterceptor());
  app.useGlobalFilters(new AllExceptionsFilter());
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
}
