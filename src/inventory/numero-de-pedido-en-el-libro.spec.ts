import { OperationResponseDto } from './dto/inventory-response.dto';
import { InventoryOperation } from './entities/inventory-operation.entity';

/**
 * MxH-0083: el libro de movimientos enseñaba el identificador interno del
 * pedido —un UUID— donde quien lo lee espera el número que ve en todas las
 * demás pantallas: ORD-2026xxxx. Merly lo pidió así: «el número del pedido
 * debería ser el número q tenemos en cada pedido y al tocarlo debería llevarnos
 * a su detalle».
 *
 * El `orderId` sigue viajando porque es lo que el panel usa para enlazar; lo
 * que se añade es el número, que es lo que se enseña.
 */
const operacion = (orderId: string | null): InventoryOperation =>
  ({
    id: 'op-1',
    type: 'OUT',
    locationId: 'loc-1',
    targetLocationId: null,
    orderId,
    note: null,
    createdBy: 'user-1',
    createdAt: new Date('2026-10-01T03:09:31Z'),
  }) as InventoryOperation;

describe('el libro de movimientos dice de qué pedido viene', () => {
  it('lleva el número del pedido, no solo su identificador', () => {
    const dto = OperationResponseDto.build(
      operacion('ord-uuid'),
      [],
      'ORD-20260199',
    );
    expect(dto.orderNumber).toBe('ORD-20260199');
    // El identificador sigue, que es con lo que el panel arma el enlace.
    expect(dto.orderId).toBe('ord-uuid');
  });

  it('una operación manual no inventa número', () => {
    // Las entradas y salidas que hace un almacenero a mano no vienen de ningún
    // pedido: ahí no hay nada que enlazar.
    const dto = OperationResponseDto.build(operacion(null), []);
    expect(dto.orderId).toBeNull();
    expect(dto.orderNumber).toBeNull();
  });

  it('si el pedido ya no está, la operación se sigue viendo', () => {
    // Un pedido borrado no puede dejar el libro sin su línea: el movimiento
    // ocurrió igual.
    const dto = OperationResponseDto.build(operacion('ord-uuid'), []);
    expect(dto.orderId).toBe('ord-uuid');
    expect(dto.orderNumber).toBeNull();
  });
});
