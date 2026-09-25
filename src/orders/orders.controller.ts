import type { Response } from 'express';
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  Res,
  StreamableFile,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { AuthenticatedUserRequest } from '../auth/types/authenticated-request';
import { PaginatedResponse } from '../common/dto/pagination.dto';
import { Roles } from '../common/decorators/roles.decorator';
import { RequirePermission } from '../permissions/decorators/require-permission.decorator';
import { Role } from '../users/entities/user.entity';
import { AdminOrdersQueryDto } from './dto/admin-orders-query.dto';
import { SendReportDto } from './dto/send-report.dto';
import { OrderEventResponseDto } from '../order-events/dto/order-event-response.dto';
import { OrderResponseDto } from './dto/order-response.dto';
import {
  CorrectOrderDto,
  RemovePaymentAttemptDto,
} from './dto/correct-order.dto';
import { PaymentChargeResponseDto } from '../payments/dto/payment-charge-response.dto';
import { UpdateOrderItemsDto } from './dto/update-order-items.dto';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto';
import { UpdatePaymentStatusDto } from './dto/update-payment-status.dto';
import { OrderPdfService } from './order-pdf.service';
import {
  OrdersReportPdfService,
  type Periodo,
} from './orders-report-pdf.service';
import { ReportMailerService } from './report-mailer.service';
import { ReportRecipientsService } from './report-recipients.service';
import { OrdersService } from './orders.service';

// Backoffice order management, gated per-action by managed permissions
// (admins bypass). Non-admin staff granted `update-status` still only advance
// fulfillment (processing/shipped/delivered — enforced in the service, since a
// decorator can't see the target status); confirm/cancel and payment stay
// admin-level.
@ApiTags('orders')
@ApiBearerAuth()
@Controller('orders')
export class OrdersController {
  constructor(
    private readonly ordersService: OrdersService,
    private readonly orderPdfService: OrderPdfService,
    private readonly ordersReportPdfService: OrdersReportPdfService,
    private readonly reportRecipients: ReportRecipientsService,
    private readonly reportMailer: ReportMailerService,
  ) {}

  @Get()
  @RequirePermission({ module: 'orders', action: 'list' })
  @ApiOperation({
    summary: 'List orders (server-paginated)',
    description:
      'Filters: `q` (order number / client name / client email / client phone), `status`, ' +
      '`paymentStatus`, `id` (comma list). Sort with `sortBy` + `sortOrder`; ' +
      'defaults to newest first.',
  })
  findAll(
    @Query() query: AdminOrdersQueryDto,
  ): Promise<PaginatedResponse<OrderResponseDto>> {
    return this.ordersService.findAllAdmin(query);
  }

  @Get(':id')
  @RequirePermission({ module: 'orders', action: 'read' })
  @ApiOperation({ summary: 'Get an order with its lines' })
  @ApiOkResponse({ type: OrderResponseDto })
  findOne(@Param('id', ParseUUIDPipe) id: string): Promise<OrderResponseDto> {
    return this.ordersService.findOneAdmin(id);
  }

  @Patch(':id/status')
  @RequirePermission({ module: 'orders', action: 'update-status' })
  @ApiOperation({
    summary: 'Advance or cancel an order',
    description:
      'Legal transitions: pending→confirmed|cancelled, ' +
      'confirmed→processing|cancelled, processing→shipped|cancelled, ' +
      'shipped→delivered|cancelled. Confirming physically decrements the ' +
      'reserved stock; cancelling releases (or restocks) it. Non-admin staff may only ' +
      'target processing/shipped/delivered. With `direct: true` ' +
      '(admins or the orders:update-status-direct permission) the order jumps straight to any later ' +
      'status or to cancelled — for manual in-store sales and pickups — and ' +
      'the skipped side effects still apply (stock commits once when passing ' +
      'confirmed).',
  })
  @ApiOkResponse({ type: OrderResponseDto })
  @ApiConflictResponse({ description: 'Illegal status transition.' })
  updateStatus(
    @Req() req: AuthenticatedUserRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateOrderStatusDto,
  ): Promise<OrderResponseDto> {
    return this.ordersService.updateStatus(
      req.user,
      id,
      dto.status,
      dto.direct ?? false,
      dto.pickedUpBy,
    );
  }

  @Post(':id/reinstate')
  @HttpCode(200)
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
  @ApiOperation({
    summary: 'Reinstate a cancelled order («Restablecer orden»)',
    description:
      'Moves a cancelled order back to pending and re-reserves its stock. ' +
      'Only the order status changes: the payment status is untouched, and ' +
      'the payment window restarts now, so an order nobody pays expires ' +
      'again. Admins only. 409 when the order is not cancelled, was paid ' +
      'after expiring (refund instead), or the stock is gone.',
  })
  @ApiOkResponse({ type: OrderResponseDto })
  @ApiConflictResponse({
    description: 'Not cancelled, needs a refund instead, or out of stock.',
  })
  reinstate(
    @Req() req: AuthenticatedUserRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<OrderResponseDto> {
    return this.ordersService.reinstate(req.user, id);
  }

  @Patch(':id/payment-status')
  @RequirePermission({ module: 'orders', action: 'update-payment-status' })
  @ApiOperation({
    summary: 'Set the payment status (manual payments)',
    description:
      'Until a payment platform is integrated, admins settle payments here ' +
      '(paid / failed / refunded).',
  })
  @ApiOkResponse({ type: OrderResponseDto })
  updatePaymentStatus(
    @Req() req: AuthenticatedUserRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePaymentStatusDto,
  ): Promise<OrderResponseDto> {
    return this.ordersService.updatePaymentStatus(
      req.user,
      id,
      dto.paymentStatus,
    );
  }

  @Post(':id/correct')
  @HttpCode(200)
  @Roles(Role.SUPER_ADMIN)
  @ApiOperation({
    summary: 'Super admin correction: any order/payment status, any direction',
    description:
      'Moves the order and/or payment status wherever the super admin says, ' +
      'applying the stock effect of the move (re-reserve, commit, release or ' +
      'restock). A reason is mandatory and lands in the order history flagged ' +
      'as a correction. When the result is pending and unpaid, the payment ' +
      'window restarts. 409 when nothing changes or the stock is gone. ' +
      'The service enforces SUPER_ADMIN even though ADMIN bypasses guards.',
  })
  @ApiOkResponse({ type: OrderResponseDto })
  @ApiConflictResponse({ description: 'No change, or out of stock.' })
  correct(
    @Req() req: AuthenticatedUserRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CorrectOrderDto,
  ): Promise<OrderResponseDto> {
    return this.ordersService.correct(req.user, id, dto);
  }

  @Patch(':id/items')
  @Roles(Role.SUPER_ADMIN)
  @ApiOperation({
    summary: 'Super admin correction: the lines of the order',
    description:
      'Takes the lines as they must end up (not operations): quantities, ' +
      'products added or removed, and optional unit prices. Recalculates the ' +
      'subtotal and the total (the delivery fee is untouched) and moves the ' +
      'stock according to the phase the order is in — a pending order re-holds ' +
      'the difference, a confirmed one commits or restocks it, a cancelled one ' +
      'moves nothing. Drops are applied before rises. A reason is mandatory ' +
      'and lands in the history flagged as a correction. 409 when nothing ' +
      'changes, a new product is not on sale, or the stock is gone. ' +
      'The service enforces SUPER_ADMIN even though ADMIN bypasses guards.',
  })
  @ApiOkResponse({ type: OrderResponseDto })
  @ApiConflictResponse({
    description: 'No change, not on sale, or out of stock.',
  })
  updateItems(
    @Req() req: AuthenticatedUserRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateOrderItemsDto,
  ): Promise<OrderResponseDto> {
    return this.ordersService.updateItems(req.user, id, dto);
  }

  @Get(':id/payment-attempts')
  @RequirePermission({ module: 'orders', action: 'read' })
  @ApiOperation({ summary: 'Every payment attempt of the order, newest first' })
  @ApiOkResponse({ type: PaymentChargeResponseDto, isArray: true })
  listPaymentAttempts(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<PaymentChargeResponseDto[]> {
    return this.ordersService.listPaymentAttempts(id);
  }

  @Delete(':id/payment-attempts/:chargeId')
  @Roles(Role.SUPER_ADMIN)
  @ApiOperation({
    summary: 'Remove a payment attempt that never completed (super admin)',
    description:
      'Deletes the attempt so the order shows no pending link/deposit for it. ' +
      'A succeeded charge is never removable (409): that is money, refund it. ' +
      'Reason mandatory; recorded in the order history.',
  })
  @ApiOkResponse({ type: OrderResponseDto })
  removePaymentAttempt(
    @Req() req: AuthenticatedUserRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('chargeId', ParseUUIDPipe) chargeId: string,
    @Body() dto: RemovePaymentAttemptDto,
  ): Promise<OrderResponseDto> {
    return this.ordersService.removePaymentAttempt(
      req.user,
      id,
      chargeId,
      dto.reason,
    );
  }

  // Antes de `:id/pdf` a propósito: si fuera después, Nest tomaría «report»
  // por un id de pedido y devolvería un 400 por UUID inválido.
  @Get('report/pdf')
  @RequirePermission({ module: 'orders', action: 'read' })
  @ApiOperation({
    summary: 'Reporte de pedidos en PDF',
    description:
      'El listado filtrado, en papel: una fila por pedido y los totales por ' +
      'estado al final. Acepta **los mismos filtros que el listado** —la ' +
      'misma consulta—, así que lo que se ve en pantalla es lo que sale. Sin ' +
      'paginar: trae todos los que casen, no la página que se esté mirando.',
  })
  async reportePdf(
    @Query() query: AdminOrdersQueryDto,
    @Query('groupBy') groupBy: Periodo | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    // El resumen es opcional: sin `groupBy` sale el listado y los totales, que
    // es lo que se pedía antes de que Jade viera la referencia con tendencia.
    const periodo: Periodo | null =
      groupBy === 'day' || groupBy === 'week' || groupBy === 'month'
        ? groupBy
        : null;
    const [{ pedidos, recortado }, totales, filasResumen] = await Promise.all([
      this.ordersService.findAllForReport(query),
      this.ordersService.totalesForReport(query),
      periodo
        ? this.ordersService.resumenPorPeriodo(query, periodo)
        : Promise.resolve([]),
    ]);
    const pdf = await this.ordersReportPdfService.generate(
      pedidos,
      totales,
      query,
      recortado,
      periodo ? { periodo, filas: filasResumen } : null,
    );
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${this.ordersReportPdfService.nombreDelFichero(query)}"`,
      'Content-Length': pdf.length.toString(),
    });
    return new StreamableFile(pdf);
  }

  @Post('report/email')
  @RequirePermission({ module: 'orders', action: 'read' })
  @ApiOperation({
    summary: 'Mandar el reporte por correo',
    description:
      'Genera el mismo PDF y lo manda adjunto a las direcciones indicadas y ' +
      'a **todos los usuarios de los roles** elegidos. Los roles se resuelven ' +
      'en el momento del envío: quien entre mañana en el rol lo recibirá sin ' +
      'que nadie actualice una lista. Devuelve a quién se le mandó y a quién ' +
      'no se pudo.',
  })
  async enviarReporte(
    @Body() dto: SendReportDto,
    @Req() req: AuthenticatedUserRequest,
  ) {
    const filtros = dto.filtros ?? {};
    const destinatarios = await this.reportRecipients.resolver(
      dto.emails,
      dto.roleIds,
    );
    if (!destinatarios.correos.length) {
      throw new BadRequestException(
        'No hay ninguna dirección a la que mandar el reporte: ni correos escritos ni usuarios con correo en los roles elegidos.',
      );
    }

    const [{ pedidos, recortado }, totales, filasResumen] = await Promise.all([
      this.ordersService.findAllForReport(filtros),
      this.ordersService.totalesForReport(filtros),
      dto.groupBy
        ? this.ordersService.resumenPorPeriodo(filtros, dto.groupBy)
        : Promise.resolve([]),
    ]);
    const pdf = await this.ordersReportPdfService.generate(
      pedidos,
      totales,
      filtros,
      recortado,
      dto.groupBy ? { periodo: dto.groupBy, filas: filasResumen } : null,
    );

    const solicitante =
      [req.user?.firstName, req.user?.lastName].filter(Boolean).join(' ') ||
      req.user?.email ||
      null;
    const envio = await this.reportMailer.enviar(
      destinatarios.correos,
      pdf,
      this.ordersReportPdfService.nombreDelFichero(filtros),
      {
        criterios: this.ordersReportPdfService.criteriosEnPalabras(filtros),
        pedidos: totales.reduce((suma, t) => suma + t.pedidos, 0),
        importe: totales
          .reduce((suma, t) => suma + Number(t.importe), 0)
          .toFixed(2),
        solicitante,
      },
    );

    return {
      ...envio,
      destinatarios: destinatarios.detalle,
      rolesVacios: destinatarios.rolesVacios,
      sinCorreo: destinatarios.sinCorreo,
    };
  }

  @Get(':id/pdf')
  @RequirePermission({ module: 'orders', action: 'read' })
  @ApiOperation({
    summary: 'Comprobante del pedido en PDF',
    description:
      'El pedido en papel: cabecera con los datos de la empresa, líneas, ' +
      'totales y pie con los enlaces legales que tenga configurados la ' +
      'tienda. **No es una factura** y el propio documento lo dice.',
  })
  async pdf(
    @Param('id', ParseUUIDPipe) id: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const order = await this.orderPdfService.findOrderOrFail(id);
    const pdf = await this.orderPdfService.generate(id);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${this.orderPdfService.fileNameFor(order)}"`,
      'Content-Length': pdf.length.toString(),
    });
    return new StreamableFile(pdf);
  }

  @Get(':id/events')
  @RequirePermission({ module: 'orders', action: 'read' })
  @ApiOperation({
    summary: 'Order history',
    description:
      'Every change the order went through, oldest first: creation, status ' +
      'and payment changes, payment attempts, proofs, reinstatements and ' +
      'expiry, each with who did it (admin, client or the system).',
  })
  @ApiOkResponse({ type: OrderEventResponseDto, isArray: true })
  listEvents(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<OrderEventResponseDto[]> {
    return this.ordersService.listEvents(id);
  }
}
