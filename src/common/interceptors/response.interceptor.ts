import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  StreamableFile,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

export interface Envelope<T> {
  data: T;
}

/**
 * Envuelve la respuesta en `{ data }`, que es el contrato que espera el
 * cliente de la administración.
 *
 * **Una descarga se deja pasar tal cual.** Envolver un `StreamableFile` en
 * JSON produce un archivo que no abre ningún lector: pasó con el comprobante
 * del pedido en PDF, y le pasará a cualquier descarga que venga después.
 */
@Injectable()
export class ResponseInterceptor<T> implements NestInterceptor<
  T,
  Envelope<T> | StreamableFile
> {
  intercept(
    _context: ExecutionContext,
    next: CallHandler<T>,
  ): Observable<Envelope<T> | StreamableFile> {
    return next
      .handle()
      .pipe(map((data) => (data instanceof StreamableFile ? data : { data })));
  }
}
