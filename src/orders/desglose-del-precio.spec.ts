import { OrderItemResponseDto } from './dto/order-response.dto';
import { OrderItem } from './entities/order-item.entity';

const linea = (extra: Partial<OrderItem>): OrderItem =>
  ({
    productId: 'p1',
    productNameSnapshot: 'Cola',
    quantity: 2,
    listPrice: null,
    discount: null,
    unitPrice: '80.00',
    lineTotal: '160.00',
    ...extra,
  }) as OrderItem;

/**
 * MxH-0056. La línea guardaba solo lo cobrado, que es el resultado. Sin saber
 * de dónde salió, dentro de un año no hay forma de distinguir una venta a 80
 * de un producto que valía 80 de otra de un producto de 100 con 20% de rebaja:
 * el catálogo habrá cambiado y el dato no se recupera.
 */
describe('El desglose del precio de una línea', () => {
  it('cuenta el precio de lista y la rebaja del día de la compra', () => {
    const dto = OrderItemResponseDto.fromEntity(
      linea({ listPrice: '100.00', discount: '20.00' }),
    );
    expect(dto.listPrice).toBe(100);
    expect(dto.discount).toBe(20);
    expect(dto.unitPrice).toBe(80);
  });

  it('el desglose explica el precio cobrado', () => {
    const dto = OrderItemResponseDto.fromEntity(
      linea({ listPrice: '100.00', discount: '20.00' }),
    );
    const calculado =
      Math.round(dto.listPrice! * (1 - dto.discount! / 100) * 100) / 100;
    expect(calculado).toBe(dto.unitPrice);
  });

  /**
   * De una línea anterior a esta tarjeta se conoce lo cobrado y nada más.
   * Devolver `listPrice = unitPrice` y `discount = 0` afirmaría que no hubo
   * rebaja, y sería falso en todas las que sí la tuvieron. Un nulo dice «esto
   * no se registró», que es la verdad.
   */
  it('las líneas viejas no se inventan un desglose', () => {
    const dto = OrderItemResponseDto.fromEntity(linea({}));
    expect(dto.listPrice).toBeNull();
    expect(dto.discount).toBeNull();
    expect(dto.unitPrice).toBe(80);
  });

  it('un precio sin rebaja se cuenta con rebaja cero, no con nulo', () => {
    const dto = OrderItemResponseDto.fromEntity(
      linea({ listPrice: '80.00', discount: '0.00', unitPrice: '80.00' }),
    );
    expect(dto.discount).toBe(0);
    expect(dto.listPrice).toBe(80);
  });
});
