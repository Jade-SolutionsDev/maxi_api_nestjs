import { Controller, Get, Param } from '@nestjs/common';
import {
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Public } from '../common/decorators/public.decorator';
import { StrictThrottle } from '../common/throttle';
import { OrderTrackingResponseDto } from './dto/order-tracking.dto';
import { OrdersService } from './orders.service';

/**
 * Seguimiento del pedido **sin iniciar sesión** (MxH-0059).
 *
 * Vive en su propio controlador y no junto al resto de pedidos de la tienda
 * porque aquel exige sesión de cliente en toda la clase, y aquí el requisito
 * es justo el contrario: que funcione con solo tener el enlace, guardado en el
 * móvil o reenviado por WhatsApp.
 *
 * Lo que compensa esa puerta abierta: el identificador no se puede adivinar
 * (32 bytes aleatorios), la respuesta no lleva datos personales ni dinero —lo
 * acota `OrderTrackingResponseDto`—, y el límite de peticiones impide tantear
 * a ciegas.
 */
@ApiTags('storefront')
@Controller('storefront/tracking')
@Public()
export class OrderTrackingController {
  constructor(private readonly ordersService: OrdersService) {}

  @Get(':trackingId')
  @StrictThrottle()
  @ApiOperation({
    summary: 'Estado de un pedido a partir de su enlace de seguimiento',
    description:
      'Público, sin sesión. Devuelve el número de pedido, el estado en el ' +
      'vocabulario del cliente, si está pagado, las fechas, el plazo ' +
      'comprometido y el historial de estados. No devuelve datos del cliente, ' +
      'dirección, importes ni productos. Un identificador inexistente y uno ' +
      'mal formado responden igual: 404 sin distinción.',
  })
  @ApiOkResponse({ type: OrderTrackingResponseDto })
  @ApiNotFoundResponse({ description: 'No hay ningún pedido con ese enlace.' })
  track(
    @Param('trackingId') trackingId: string,
  ): Promise<OrderTrackingResponseDto> {
    return this.ordersService.trackByPublicId(trackingId);
  }
}
