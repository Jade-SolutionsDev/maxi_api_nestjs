import { ExecutionContext, StreamableFile } from '@nestjs/common';
import { firstValueFrom, of } from 'rxjs';
import { ResponseInterceptor } from './response.interceptor';

describe('ResponseInterceptor', () => {
  const contexto = {} as ExecutionContext;
  const interceptor = new ResponseInterceptor();

  it('envuelve la respuesta normal en { data }', async () => {
    const salida = await firstValueFrom(
      interceptor.intercept(contexto, { handle: () => of({ id: 'o-1' }) }),
    );

    expect(salida).toEqual({ data: { id: 'o-1' } });
  });

  it('deja pasar una descarga sin tocarla', async () => {
    // Envolver un archivo en JSON produce algo que ningún lector abre; le
    // pasó al comprobante del pedido en PDF.
    const archivo = new StreamableFile(Buffer.from('%PDF-1.3 fingido'));

    const salida = await firstValueFrom(
      interceptor.intercept(contexto, { handle: () => of(archivo) }),
    );

    expect(salida).toBe(archivo);
  });

  it('un nulo sigue envolviéndose, no se confunde con un archivo', async () => {
    const salida = await firstValueFrom(
      interceptor.intercept(contexto, { handle: () => of(null) }),
    );

    expect(salida).toEqual({ data: null });
  });
});
