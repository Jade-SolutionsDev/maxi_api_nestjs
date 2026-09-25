import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { AuthenticatedUserRequest } from '../auth/types/authenticated-request';
import { RequirePermission } from '../permissions/decorators/require-permission.decorator';
import {
  CompleteRefundDto,
  CreateRefundDto,
  RefundResponseDto,
  RejectRefundDto,
} from './dto/refund.dto';
import { RefundStatus } from './entities/refund.entity';
import { RefundsService, RefundSummary } from './refunds.service';

/**
 * La cola de devoluciones: lo que espera a que alguien mueva el dinero.
 *
 * Confirmar y rechazar viven aquí y no bajo el pedido porque se trabajan desde
 * la cola, que es donde se ve todo lo pendiente junto.
 */
@ApiTags('refunds')
@ApiBearerAuth()
@Controller('refunds')
export class RefundsController {
  constructor(private readonly refundsService: RefundsService) {}

  @Get()
  @RequirePermission({ module: 'refunds', action: 'list' })
  @ApiOperation({
    summary: 'Cola de devoluciones',
    description:
      'Por defecto las que esperan (`requested`), lo más viejo primero. ' +
      'Filtra con `status` para ver las hechas o las rechazadas.',
  })
  @ApiOkResponse({ type: [RefundResponseDto] })
  list(@Query('status') status?: RefundStatus): Promise<RefundResponseDto[]> {
    return this.refundsService.listQueue(status);
  }

  @Post(':id/complete')
  @RequirePermission({ module: 'refunds', action: 'complete' })
  @ApiOperation({
    summary: 'Confirmar que el dinero salió',
    description:
      'Marca la devolución como hecha. Si con esta se devuelve todo lo ' +
      'cobrado, el pedido pasa a «reembolsado»; si es parcial, sigue cobrado ' +
      'por el resto. Avisa al cliente por correo.',
  })
  complete(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CompleteRefundDto,
    @Req() req: AuthenticatedUserRequest,
  ): Promise<RefundResponseDto> {
    return this.refundsService.complete(req.user, id, dto);
  }

  @Post(':id/reject')
  @RequirePermission({ module: 'refunds', action: 'reject' })
  @ApiOperation({
    summary: 'Rechazar una devolución',
    description: 'No procede. Queda en la ficha con su motivo; no se borra.',
  })
  reject(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RejectRefundDto,
    @Req() req: AuthenticatedUserRequest,
  ): Promise<RefundResponseDto> {
    return this.refundsService.reject(req.user, id, dto);
  }
}

/** Las devoluciones de un pedido, desde su ficha. */
@ApiTags('refunds')
@ApiBearerAuth()
@Controller('orders/:orderId/refunds')
export class OrderRefundsController {
  constructor(private readonly refundsService: RefundsService) {}

  @Get()
  @RequirePermission({ module: 'refunds', action: 'read' })
  @ApiOperation({ summary: 'Devoluciones de un pedido' })
  @ApiOkResponse({ type: [RefundResponseDto] })
  list(
    @Param('orderId', ParseUUIDPipe) orderId: string,
  ): Promise<RefundResponseDto[]> {
    return this.refundsService.listForOrder(orderId);
  }

  @Get('summary')
  @RequirePermission({ module: 'refunds', action: 'read' })
  @ApiOperation({
    summary: 'Cuánto queda por devolver',
    description:
      'Cobrado, devuelto, comprometido y lo que aún se puede devolver.',
  })
  summary(
    @Param('orderId', ParseUUIDPipe) orderId: string,
  ): Promise<RefundSummary> {
    return this.refundsService.summary(orderId);
  }

  @Post()
  @RequirePermission({ module: 'refunds', action: 'request' })
  @ApiOperation({
    summary: 'Registrar una devolución',
    description:
      'Solo sobre pedidos cobrados. Sin importe se devuelve todo lo que quede ' +
      'pendiente. Esto no mueve dinero: deja el compromiso en la cola.',
  })
  request(
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Body() dto: CreateRefundDto,
    @Req() req: AuthenticatedUserRequest,
  ): Promise<RefundResponseDto> {
    return this.refundsService.request(orderId, dto, { userId: req.user.id });
  }
}
