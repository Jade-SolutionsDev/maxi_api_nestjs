import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Response } from 'express';

export interface ErrorDetail {
  field?: string;
  message: string;
}

export interface ErrorEnvelope {
  error: {
    code: string;
    message: string;
    details?: ErrorDetail[];
  };
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    const envelope: ErrorEnvelope = {
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'An unexpected error occurred',
      },
    };

    if (exception instanceof HttpException) {
      const res = exception.getResponse();
      envelope.error.code = exception.name;
      envelope.error.message =
        typeof res === 'string'
          ? res
          : ((res as { message?: string }).message ?? envelope.error.message);

      if (
        typeof res === 'object' &&
        res !== null &&
        'message' in res &&
        Array.isArray(res.message)
      ) {
        envelope.error.details = (res as { message: string[] }).message.map(
          (message) => ({ message }),
        );
      }
    }

    response.status(status).json(envelope);
  }
}
