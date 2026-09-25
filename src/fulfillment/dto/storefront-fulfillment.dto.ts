/** What the checkout screen may offer this customer. */
export class StorefrontDeliveryOptionDto {
  id: string;
  label: string;
  description: string | null;
  fee: number;
  /** Días hábiles prometidos para esta opción; null si no hay compromiso. */
  promiseDays: number | null;
}

/** A counter the customer can collect from. */
export class StorefrontPickupPointDto {
  /** stock_location_pickup_addresses.id — what checkout sends back. */
  id: string;
  locationId: string;
  locationName: string;
  label: string | null;
  address: string;
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
}
