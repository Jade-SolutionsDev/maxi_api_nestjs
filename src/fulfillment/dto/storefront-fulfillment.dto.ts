/** What the checkout screen may offer this customer. */
export class StorefrontDeliveryOptionDto {
  id: string;
  label: string;
  description: string | null;
  fee: number;
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
   * Set when the shop can fulfil nothing: show this instead of a picker and
   * keep the customer from submitting.
   */
  unavailableMessage: string | null;
}
