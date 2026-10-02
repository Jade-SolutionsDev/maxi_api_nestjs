import { BadRequestException } from '@nestjs/common';
import { OrdersService } from './orders.service';

/**
 * El periodo se interpola en el `date_trunc` del SQL, así que no puede llegar
 * sin comprobar. El DTO ya lo valida, pero esta es la red de abajo: vale para
 * cualquiera que llame al servicio directamente.
 */
describe('OrdersService · resumenPorPeriodo', () => {
  const servicio = Object.create(OrdersService.prototype) as OrdersService;

  it.each(['año; DROP TABLE orders', 'siglo', '', 'DAY'])(
    'no interpola «%s» en el SQL',
    async (periodo) => {
      await expect(
        servicio.resumenPorPeriodo({}, periodo as never),
      ).rejects.toBeInstanceOf(BadRequestException);
    },
  );

  it('un periodo válido pasa de la comprobación', async () => {
    // Sin repositorio detrás falla más adelante, al construir la consulta: lo
    // que importa es que NO lo rechaza por el periodo.
    await expect(
      servicio.resumenPorPeriodo({}, 'week'),
    ).rejects.not.toBeInstanceOf(BadRequestException);
  });
});
