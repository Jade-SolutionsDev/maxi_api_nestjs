import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ClerkClientAuthGuard } from '../auth/guards/clerk-client-auth.guard';
import type { AuthenticatedClientRequest } from '../auth/types/authenticated-request';
import { Public } from '../common/decorators/public.decorator';
import { StorefrontFulfillmentDto } from './dto/storefront-fulfillment.dto';
import { FulfillmentService } from './fulfillment.service';

// What checkout may offer this customer (same guard pattern as the cart).
@ApiTags('storefront')
@Controller('storefront/fulfillment')
@Public()
@UseGuards(ClerkClientAuthGuard)
export class StorefrontFulfillmentController {
  constructor(private readonly fulfillmentService: FulfillmentService) {}

  @Get()
  @ApiOperation({
    summary: 'Delivery options and pickup points available to the customer',
    description:
      'Options are filtered to the municipality being delivered to. When ' +
      '`unavailableMessage` is set the shop can fulfil nothing: show it and ' +
      'do not let the customer submit — checkout rejects it anyway.',
  })
  @ApiOkResponse({ type: StorefrontFulfillmentDto })
  find(
    @Req() req: AuthenticatedClientRequest,
    @Query('municipalityId') municipalityId?: string,
  ): Promise<StorefrontFulfillmentDto> {
    return this.fulfillmentService.availableForClient(
      municipalityId ?? req.client.defaultMunicipalityId ?? undefined,
    );
  }
}
