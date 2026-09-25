import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AdminOrdersQueryDto } from './admin-orders-query.dto';

/**
 * El formulario del reporte manda todos sus campos, también los que el usuario
 * dejó en blanco. Sin esto, un `from: ''` hacía que `@IsDateString` tumbara la
 * petición entera con un 400 que en el panel se veía como «Failed to fetch».
 */
describe('AdminOrdersQueryDto · campos en blanco', () => {
  const validar = async (crudo: Record<string, unknown>) => {
    const dto = plainToInstance(AdminOrdersQueryDto, crudo);
    return { dto, errores: await validate(dto) };
  };

  it('acepta el cuerpo que manda el formulario con campos vacíos', async () => {
    const { errores } = await validar({
      from: '',
      to: '',
      status: 'cancelled',
      paymentStatus: 'pending',
      paymentMethod: '',
      fulfillmentType: '',
      pickupLocationId: '',
      minTotal: '',
      maxTotal: '',
      q: '',
    });
    expect(errores).toEqual([]);
  });

  it('un campo en blanco no filtra nada', async () => {
    const { dto } = await validar({ from: '', status: 'cancelled' });
    expect(dto.from).toBeUndefined();
    expect(dto.status).toBe('cancelled');
  });

  // Lo que sí trae valor se sigue validando: un rango mal escrito debe fallar,
  // no colarse.
  it('una fecha inventada sigue siendo un error', async () => {
    const { errores } = await validar({ from: 'ayer por la tarde' });
    expect(errores).not.toEqual([]);
  });

  it('un identificador que no es UUID sigue siendo un error', async () => {
    const { errores } = await validar({ pickupLocationId: 'el-de-cardenas' });
    expect(errores).not.toEqual([]);
  });
});
