import { Body, Controller, Get, Put, Req, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { ClerkClientAuthGuard } from '../auth/guards/clerk-client-auth.guard';
import type { AuthenticatedClientRequest } from '../auth/types/authenticated-request';
import { Public } from '../common/decorators/public.decorator';
import { ClientsService } from './clients.service';
import {
  ClientLocationResponseDto,
  SaveClientLocationDto,
} from './dto/client-location.dto';

/**
 * La zona del cliente con sesión, para que no haya que preguntarla en cada
 * dispositivo (MxH-0040).
 *
 * Mismo patrón de guardas que el carrito y las direcciones: `@Public()` salta
 * el guarda del backoffice y `ClerkClientAuthGuard` autentica al comprador.
 * **Nunca recibe un id de cliente**: trabaja siempre sobre `req.client`, así
 * que nadie puede leer ni mover la zona de otro.
 */
@ApiTags('storefront')
@ApiBearerAuth()
@Controller('storefront/location')
@Public()
@UseGuards(ClerkClientAuthGuard)
export class StorefrontClientLocationController {
  constructor(private readonly clientsService: ClientsService) {}

  @Get()
  @ApiOperation({ summary: 'La zona guardada en la cuenta del cliente' })
  @ApiOkResponse({ type: ClientLocationResponseDto })
  read(@Req() req: AuthenticatedClientRequest): ClientLocationResponseDto {
    // Sale de la sesión ya cargada: el guarda trae el cliente entero, así que
    // esto no toca la base.
    return { municipalityId: req.client.defaultMunicipalityId };
  }

  @Put()
  @ApiOperation({
    summary: 'Guardar la zona del cliente',
    description:
      'Se guarda la zona **actual** del cliente, no la de un pedido. Los ' +
      'pedidos ya hechos no cambian: cada uno guarda su propia copia de la ' +
      'dirección y del municipio de entrega.',
  })
  @ApiOkResponse({ type: ClientLocationResponseDto })
  @ApiNotFoundResponse({
    description: 'Ese municipio no existe o está dado de baja.',
  })
  async save(
    @Req() req: AuthenticatedClientRequest,
    @Body() dto: SaveClientLocationDto,
  ): Promise<ClientLocationResponseDto> {
    const client = await this.clientsService.saveDefaultMunicipality(
      req.client.id,
      dto.municipalityId,
    );

    return { municipalityId: client.defaultMunicipalityId };
  }
}
