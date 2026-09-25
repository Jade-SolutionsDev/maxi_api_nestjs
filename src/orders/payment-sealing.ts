import { finDelPlazo } from '../common/business-days';
import { Order } from './entities/order.entity';

/**
 * Sella en el pedido que se cobró: la fecha del cobro y, con ella, hasta
 * cuándo está comprometida la entrega.
 *
 * Vive aquí y no repetido en cada sitio porque hay tres caminos por los que
 * un pedido queda pagado —el webhook de la pasarela, marcarlo a mano y la
 * corrección de superadministrador— y los tres deben dejar el mismo rastro.
 * De `paidAt` cuelgan la custodia, sus recordatorios y ahora el plazo.
 */
export const sellarCobro = (order: Order, cuando: Date = new Date()): void => {
  if (!order.paidAt) {
    order.paidAt = cuando;
  }
  if (!order.promisedAt) {
    order.promisedAt = finDelPlazo(order.paidAt, order.promiseDays);
  }
};

/**
 * Deshace el sellado: el pedido vuelve a estar sin cobrar.
 *
 * Solo lo usa la corrección de superadministrador. Si se deshace el cobro, la
 * promesa de entrega deja de tener sentido —no hay plazo que contar desde un
 * pago que ya no existe— y la custodia tampoco debe seguir corriendo.
 */
export const deshacerCobro = (order: Order): void => {
  order.paidAt = null;
  order.promisedAt = null;
};

/** ¿Se entregó dentro del plazo? `null` cuando no hay promesa o no se entregó. */
export const llegoATiempo = (order: Order): boolean | null => {
  if (!order.promisedAt || !order.deliveredAt) {
    return null;
  }
  return order.deliveredAt.getTime() <= order.promisedAt.getTime();
};
