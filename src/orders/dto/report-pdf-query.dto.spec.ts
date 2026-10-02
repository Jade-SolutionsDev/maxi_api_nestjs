import { ValidationPipe } from '@nestjs/common';
import { ReportPdfQueryDto } from './report-pdf-query.dto';

/**
 * Se valida con el MISMO pipe que monta `main.ts`, `forbidNonWhitelisted`
 * incluido: el fallo que esto persigue no estaba en el DTO sino en que un
 * parámetro sin declarar tumba la petición entera.
 */
const pipe = new ValidationPipe({
  transform: true,
  whitelist: true,
  forbidNonWhitelisted: true,
});
const validar = (query: Record<string, unknown>) =>
  pipe.transform(query, { type: 'query', metatype: ReportPdfQueryDto });

describe('ReportPdfQueryDto', () => {
  it('acepta el resumen por semanas, que es lo que manda el panel', async () => {
    // Esta es la petición exacta que daba 400 en producción el 2-oct-2026.
    await expect(
      validar({ status: 'delivered', paymentStatus: 'paid', groupBy: 'week' }),
    ).resolves.toMatchObject({ groupBy: 'week' });
  });

  it.each(['day', 'week', 'month'])('acepta groupBy=%s', async (periodo) => {
    await expect(validar({ groupBy: periodo })).resolves.toMatchObject({
      groupBy: periodo,
    });
  });

  it('sin groupBy sale el informe sin resumen', async () => {
    await expect(validar({ status: 'delivered' })).resolves.toMatchObject({
      status: 'delivered',
    });
  });

  it('un groupBy en blanco es «sin resumen», no un error', async () => {
    // El formulario manda el campo vacío cuando no se elige nada. No tiene que
    // dar error, y tiene que quedar sin valor para que no agrupe.
    await expect(validar({ groupBy: '' })).resolves.toHaveProperty(
      'groupBy',
      undefined,
    );
  });

  it('rechaza un periodo que no existe', async () => {
    await expect(validar({ groupBy: 'siglo' })).rejects.toThrow();
  });

  it('sigue rechazando un parámetro inventado', async () => {
    // La lista blanca es la que protege al endpoint; esto comprueba que
    // declarar `groupBy` no la ha desactivado de paso.
    await expect(validar({ inventado: 'x' })).rejects.toThrow();
  });
});
