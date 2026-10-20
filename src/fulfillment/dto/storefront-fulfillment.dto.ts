/** What the checkout screen may offer this customer. */
export class StorefrontDeliveryOptionDto {
  id: string;
  label: string;
  description: string | null;
  fee: number;
  /** Días hábiles prometidos para esta opción; null si no hay compromiso. */
  promiseDays: number | null;
  /**
   * Subtotal en USD desde el que **esta** opción sale gratis, o `null` si no
   * tiene promoción. La tienda lo necesita para decir cuánto falta, y es por
   * opción porque la promoción es del envío: la recogida no tiene ninguna.
   */
  freeDeliveryThreshold: number | null;
}

/** A counter the customer can collect from. */
export class StorefrontPickupPointDto {
  /** stock_location_pickup_addresses.id — what checkout sends back. */
  id: string;
  locationId: string;
  locationName: string;
  label: string | null;
  address: string;
  /** Cuándo se puede pasar a recogerlo. `null` = sin horario publicado. */
  hours: string | null;
}

/**
 * Por qué la tienda no puede despachar aquí (MxH-0093).
 *
 * Los dos casos piden cosas distintas del cliente, y hasta ahora los dos
 * salían con el mismo texto: «no podemos procesar pedidos en línea», que
 * suena a avería general y no deja hacer nada.
 */
export enum MotivoSinEntrega {
  /** No hay ninguna forma de entrega dada de alta en toda la tienda. */
  SIN_CONFIGURAR = 'sin_configurar',
  /** Las hay, pero ninguna llega a esta zona: cambiar de zona sí sirve. */
  FUERA_DE_ZONA = 'fuera_de_zona',
}

export class StorefrontFulfillmentDto {
  deliveryOptions: StorefrontDeliveryOptionDto[];
  pickupPoints: StorefrontPickupPointDto[];
  /** False ⇒ do not offer pickup at all, whatever the points say. */
  pickupEnabled: boolean;
  /**
   * Días hábiles que se tarda en tener el pedido listo para recoger. Vive en
   * los ajustes y no en cada punto, así que sin publicarlo aquí la tienda no
   * tiene forma de prometer fecha en una recogida — que es justo el caso de
   * Maxi, donde toda la venta se recoge en el mostrador.
   */
  pickupPromiseDays: number | null;
  /**
   * Set when the shop can fulfil nothing: show this instead of a picker and
   * keep the customer from submitting.
   */
  unavailableMessage: string | null;
  /**
   * Cuál de los dos casos es, cuando no hay nada que ofrecer. La tienda elige
   * qué contar a partir de esto; el mensaje de arriba lo sigue poniendo el
   * administrador y vale para los dos.
   */
  unavailableReason: MotivoSinEntrega | null;
}
