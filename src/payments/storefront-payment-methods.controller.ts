import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ClerkClientAuthGuard } from '../auth/guards/clerk-client-auth.guard';
import { Public } from '../common/decorators/public.decorator';
import { StorefrontPaymentMethodDto } from './dto/payment-method-response.dto';
import { PaymentMethodsService } from './payment-methods.service';

// What the checkout screen offers, in display order (same guard as the cart).
@ApiTags('storefront')
@Controller('storefront/payment-methods')
@Public()
@UseGuards(ClerkClientAuthGuard)
export class StorefrontPaymentMethodsController {
  constructor(private readonly methodsService: PaymentMethodsService) {}

  @Get()
  @ApiOperation({
    summary: 'Payment methods the customer can choose from',
    description:
      'Only methods an admin enabled AND whose credentials are present. May ' +
      'be a single entry — render the picker only when there is more than one.',
  })
  @ApiOkResponse({ type: [StorefrontPaymentMethodDto] })
  findAvailable(): Promise<StorefrontPaymentMethodDto[]> {
    return this.methodsService.findAvailableForStorefront();
  }
}
