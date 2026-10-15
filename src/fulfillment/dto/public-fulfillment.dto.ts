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
}
