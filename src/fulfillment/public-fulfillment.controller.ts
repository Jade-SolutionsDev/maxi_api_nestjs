import { Controller, Get, Header, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../common/decorators/public.decorator';
import { PublicFulfillmentDto } from './dto/public-fulfillment.dto';
import { FulfillmentService } from './fulfillment.service';

/**
 * Si en esta zona se puede recibir algo, para decirlo **antes** del checkout.
 *
 * `/storefront/fulfillment` ya responde esto y mucho más, pero pide sesión: a
 * quien todavía no ha entrado no se le puede avisar con ella, y es justo quien
 * está llenando el carrito. Aquí no va ni un mostrador ni una dirección, solo
 * si hay forma de despachar y el mensaje que la tienda ya enseña cuando no la
 * hay (P-046).
 */
@ApiTags('public')
@Controller('public/fulfillment')
@Public()
export class PublicFulfillmentController {
  constructor(private readonly fulfillmentService: FulfillmentService) {}

  @Get('availability')
  // Depende de la configuración de entregas y del stock por zona, que cambian
  // en minutos, no en meses: un minuto en el navegador y medio día sirviendo
  // lo viejo mientras se rehace por detrás.
  @Header('Cache-Control', 'public, max-age=60, stale-while-revalidate=43200')
  @ApiOperation({
    summary: 'Whether anything can be fulfilled in a municipality',
    description:
      'For warning the customer before checkout instead of at it. Returns no ' +
      'counters and no addresses: only whether there is any way to fulfil ' +
      'and, when there is not, the message the shop already shows.',
  })
  @ApiOkResponse({ type: PublicFulfillmentDto })
  async availability(
    @Query('municipalityId') municipalityId?: string,
  ): Promise<PublicFulfillmentDto> {
    const offer =
      await this.fulfillmentService.availableForClient(municipalityId);
    const hayVia =
      offer.deliveryOptions.length > 0 ||
      (offer.pickupEnabled && offer.pickupPoints.length > 0);

    const { freeDeliveryThreshold } =
      await this.fulfillmentService.getSettingsResponse();

    return {
      fulfillable: hayVia,
      unavailableMessage: hayVia ? null : offer.unavailableMessage,
      freeDeliveryThreshold,
    };
  }
}
