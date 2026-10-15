import { Controller, Get, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { RequirePermission } from '../permissions/decorators/require-permission.decorator';
import { CollectionsService } from './collections.service';
import { CollectionsResponseDto } from './dto/collection-response.dto';
import { CollectionsQueryDto } from './dto/collections-query.dto';

@ApiTags('payments')
@ApiBearerAuth()
@Controller('payments/collections')
export class CollectionsController {
  constructor(private readonly collections: CollectionsService) {}

  /**
   * Solo `list`, y a propósito: esta pantalla **cuenta** el dinero, no lo
   * mueve. Cobrar sigue siendo `orders:update-payment-status`, así que dar
   * acceso a los cobros no da acceso a marcarlos.
   */
  @Get()
  @RequirePermission({ module: 'payments', action: 'list' })
  @ApiOperation({
    summary: 'El dinero que entró por las ventas, con su descuadre',
    description:
      'Una fila por pedido con actividad de pago, conciliada contra los ' +
      'cobros registrados. `unreconciled` marca los pedidos dados por ' +
      'cobrados sin ningún cobro con éxito detrás. Los totales son del ' +
      'periodo filtrado completo, no de la página.',
  })
  @ApiOkResponse({ type: CollectionsResponseDto })
  async find(
    @Query() query: CollectionsQueryDto,
  ): Promise<CollectionsResponseDto> {
    return this.collections.find(query);
  }
}
