import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { RequirePermission } from '../permissions/decorators/require-permission.decorator';
import { StorefrontFulfillmentDto } from './dto/storefront-fulfillment.dto';
import { FulfillmentService } from './fulfillment.service';

/**
 * Homólogo de backoffice de StorefrontFulfillmentController: mismo cálculo
 * (FulfillmentService.availableForClient), mismo DTO de salida, pero servido
 * al panel en vez de a la tienda.
 *
 * No es un duplicado accidental. La ruta del storefront va guardada con
 * ClerkClientAuthGuard, que exige un token de CLIENTE — y ese guard lanza 401
 * sin mirar @Public() (ver storefront-fulfillment.controller.ts). Un token
 * del panel es de otra instancia de Clerk y jamás resolvería a un cliente, así
 * que esa ruta es inalcanzable desde aquí por diseño, no por descuido.
 *
 * Y hace falta de verdad: FulfillmentService.resolveChoice solo deja omitir
 * la opción de entrega cuando hay EXACTAMENTE UNA en la zona; con dos o más
 * responde 400. Sin esta ruta, el alta de pedidos desde el panel se rompería
 * en cuanto se configure una segunda forma de entrega.
 */
@ApiTags('fulfillment')
@ApiBearerAuth()
@Controller('fulfillment')
export class FulfillmentController {
  constructor(private readonly fulfillmentService: FulfillmentService) {}

  @Get()
  // Quien puede crear un pedido en nombre de otro es exactamente quien
  // necesita saber qué opciones de entrega y recogida ofrecer.
  @RequirePermission({ module: 'orders', action: 'create' })
  @ApiOperation({
    summary: 'Delivery options and pickup points available for a municipality',
    description:
      'Same calculation and same shape as GET /storefront/fulfillment, for ' +
      'the backoffice order form. Unlike the storefront route, `municipalityId` ' +
      'is required here: there is no client session to fall back to.',
  })
  @ApiOkResponse({ type: StorefrontFulfillmentDto })
  find(
    @Query('municipalityId') municipalityId?: string,
  ): Promise<StorefrontFulfillmentDto> {
    if (!municipalityId) {
      throw new BadRequestException('municipalityId es obligatorio');
    }
    return this.fulfillmentService.availableForClient(municipalityId);
  }
}
