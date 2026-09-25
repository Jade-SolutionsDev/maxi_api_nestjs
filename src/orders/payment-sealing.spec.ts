import { Order } from './entities/order.entity';
import { deshacerCobro, llegoATiempo, sellarCobro } from './payment-sealing';

const pedido = (extra: Partial<Order> = {}): Order =>
  ({
    paidAt: null,
    promisedAt: null,
    promiseDays: null,
    deliveredAt: null,
    ...extra,
  }) as Order;

describe('sellado del cobro', () => {
  it('sella la fecha del cobro y la del compromiso', () => {
    // Lunes 7 de septiembre de 2026, mediodía en Cuba, con 2 días de plazo.
    const order = pedido({ promiseDays: 2 });

    sellarCobro(order, new Date('2026-09-07T16:00:00Z'));

    expect(order.paidAt?.toISOString()).toBe('2026-09-07T16:00:00.000Z');
    // Martes 8 y miércoles 9 → vence al final del miércoles.
    expect(order.promisedAt?.toISOString()).toBe('2026-09-10T03:59:59.000Z');
  });

  it('sin plazo prometido no hay fecha comprometida, pero sí fecha de cobro', () => {
    const order = pedido();

    sellarCobro(order, new Date('2026-09-07T16:00:00Z'));

    expect(order.paidAt).not.toBeNull();
    expect(order.promisedAt).toBeNull();
  });

  it('no reescribe un cobro ya sellado', () => {
    const antes = new Date('2026-09-01T10:00:00Z');
    const order = pedido({ paidAt: antes, promiseDays: 2 });

    sellarCobro(order, new Date('2026-09-07T16:00:00Z'));

    expect(order.paidAt).toBe(antes);
  });

  it('deshacer el cobro se lleva también el compromiso', () => {
    const order = pedido({
      paidAt: new Date('2026-09-07T16:00:00Z'),
      promisedAt: new Date('2026-09-10T03:59:59Z'),
      promiseDays: 2,
    });

    deshacerCobro(order);

    expect(order.paidAt).toBeNull();
    expect(order.promisedAt).toBeNull();
    // El plazo pactado se conserva: si vuelve a pagarse, se cuenta otra vez.
    expect(order.promiseDays).toBe(2);
  });

  describe('si llegó a tiempo', () => {
    const comprometido = new Date('2026-09-10T03:59:59Z');

    it('entregado antes del vencimiento, sí', () => {
      const order = pedido({
        promisedAt: comprometido,
        deliveredAt: new Date('2026-09-09T18:00:00Z'),
      });

      expect(llegoATiempo(order)).toBe(true);
    });

    it('entregado después, no', () => {
      const order = pedido({
        promisedAt: comprometido,
        deliveredAt: new Date('2026-09-11T14:00:00Z'),
      });

      expect(llegoATiempo(order)).toBe(false);
    });

    it('sin entregar todavía, no se juzga', () => {
      expect(llegoATiempo(pedido({ promisedAt: comprometido }))).toBeNull();
    });

    it('sin compromiso tampoco', () => {
      const order = pedido({ deliveredAt: new Date() });

      expect(llegoATiempo(order)).toBeNull();
    });
  });
});
