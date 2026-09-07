import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
  Req,
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
import { RequirePermission } from '../permissions/decorators/require-permission.decorator';
import { AdminOrdersQueryDto } from './dto/admin-orders-query.dto';
import { OrderResponseDto } from './dto/order-response.dto';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto';
import { UpdatePaymentStatusDto } from './dto/update-payment-status.dto';
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
  constructor(private readonly ordersService: OrdersService) {}

  @Get()
  @RequirePermission({ module: 'orders', action: 'list' })
  @ApiOperation({
    summary: 'List orders (server-paginated)',
    description:
      'Filters: `q` (order number / client name / client email), `status`, ' +
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
      'reserved stock; cancelling releases (or restocks) it. GROCER may only ' +
      'target processing/shipped/delivered. With `direct: true` ' +
      '(SUPER_ADMIN/ADMIN/GROCER) the order jumps straight to any later ' +
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
    );
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
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePaymentStatusDto,
  ): Promise<OrderResponseDto> {
    return this.ordersService.updatePaymentStatus(id, dto.paymentStatus);
  }
}
