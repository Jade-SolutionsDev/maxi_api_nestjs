import { ApiProperty } from '@nestjs/swagger';
import { MotivoSinEntrega } from './storefront-fulfillment.dto';

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
    enum: MotivoSinEntrega,
    description:
      'Which of the two cases it is: nothing configured anywhere, or ' +
      'configured but out of this zone. Null when it can be fulfilled.',
  })
  unavailableReason: MotivoSinEntrega | null;
}
