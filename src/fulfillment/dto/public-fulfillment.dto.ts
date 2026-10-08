import { ApiProperty } from '@nestjs/swagger';

export class PublicFulfillmentDto {
  @ApiProperty({
    description:
      'True when the shop can get an order to this municipality somehow — a ' +
      'pickup counter or a delivery option that reaches it.',
  })
  fulfillable: boolean;

  @ApiProperty({
    nullable: true,
    description:
      'What to tell the customer when nothing can be fulfilled. Null when it can.',
  })
  unavailableMessage: string | null;

  @ApiProperty({
    nullable: true,
    description:
      'Subtotal in USD from which delivery is free, or null when there is no ' +
      'such promotion. The storefront needs it to say how much is missing.',
  })
  freeDeliveryThreshold: number | null;
}
