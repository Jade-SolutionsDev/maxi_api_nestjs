import { PartialType } from '@nestjs/swagger';
import { CreateClientAddressDto } from './create-client-address.dto';

// isDefault is accepted by the shape but ignored by the service: promoting an
// address goes through PATCH /storefront/addresses/:id/default.
export class UpdateClientAddressDto extends PartialType(
  CreateClientAddressDto,
) {}
