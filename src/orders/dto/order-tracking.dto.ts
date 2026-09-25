import { OrderStatus, PaymentStatus } from '../entities/order.entity';

/**
 * Lo que ve quien abre el enlace de seguimiento, que **no tiene sesión**.
 *
 * La lista de campos es la frontera de seguridad de esta función: cualquiera
 * con el enlace ve esto y nada más. Por eso el DTO se construye campo a campo
 * en vez de partir del pedido y quitar cosas —quitar se olvida; añadir, no— y
 * por eso quedan fuera, deliberadamente:
 *
 *   - quién es el cliente: nombre, correo, teléfono, identificador;
 *   - la dirección de entrega completa, que delataría dónde vive alguien a
 *     quien solo le pasaron un enlace;
 *   - el dinero: total, subtotal, precios y coste de envío;
 *   - qué se compró.
 *
 * Queda el estado, las fechas y el plazo: lo que alguien necesita para saber
 * cuándo le llega, que es para lo que se comparte el enlace.
 */
export class OrderTrackingResponseDto {
  /** El número visible, el que el cliente reconoce: ORD-2026xxxx. */
  orderNumber: string | null;
  /** Estado en el vocabulario del cliente, no el interno. */
  status: string;
  /** Si está pagado o no; sin importes ni referencias de cobro. */
  paid: boolean;
  /** Cuándo se hizo la compra. */
  placedAt: Date;
  /** Días comprometidos de entrega, cuando la opción elegida los define. */
  promiseDays: number | null;
  /** Fecha comprometida, calculada al pagar. */
  promisedAt: Date | null;
  /** Cuándo se entregó de verdad, si ya ocurrió. */
  deliveredAt: Date | null;
  /** Si es recogida o reparto; sin la dirección. */
  fulfillmentType: string;
  /** Historial de estados con su fecha, del más antiguo al más reciente. */
  history: { status: string; at: Date }[];
}

/** Cómo se le cuenta cada estado a quien no trabaja aquí. */
export const ESTADO_PARA_EL_CLIENTE: Record<OrderStatus, string> = {
  [OrderStatus.PENDING]: 'Pendiente de pago',
  [OrderStatus.CONFIRMED]: 'Confirmado',
  [OrderStatus.PROCESSING]: 'En preparación',
  [OrderStatus.SHIPPED]: 'En camino',
  [OrderStatus.DELIVERED]: 'Entregado',
  [OrderStatus.CANCELLED]: 'Cancelado',
};

export const estaPagado = (estado: PaymentStatus): boolean =>
  estado === PaymentStatus.PAID;
