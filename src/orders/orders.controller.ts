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
import { Roles } from '../common/decorators/roles.decorator';
import { PaginatedResponse } from '../common/dto/pagination.dto';
import { Role } from '../users/entities/user.entity';
import { AdminOrdersQueryDto } from './dto/admin-orders-query.dto';
import { OrderResponseDto } from './dto/order-response.dto';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto';
import { UpdatePaymentStatusDto } from './dto/update-payment-status.dto';
import { OrdersService } from './orders.service';

// Backoffice order management. GROCER reads and advances fulfillment
// (processing/shipped/delivered — enforced in the service, since a decorator
// can't see the target status); confirm/cancel and payment are ADMIN+.
@ApiTags('orders')
@ApiBearerAuth()
@Controller('orders')
@Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.GROCER)
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Get()
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
  @ApiOperation({ summary: 'Get an order with its lines' })
  @ApiOkResponse({ type: OrderResponseDto })
  findOne(@Param('id', ParseUUIDPipe) id: string): Promise<OrderResponseDto> {
    return this.ordersService.findOneAdmin(id);
  }

  @Patch(':id/status')
  @ApiOperation({
    summary: 'Advance or cancel an order',
    description:
      'Legal transitions: pending→confirmed|cancelled, ' +
      'confirmed→processing|cancelled, processing→shipped|cancelled, ' +
      'shipped→delivered|cancelled. Confirming physically decrements the ' +
      'reserved stock; cancelling releases (or restocks) it. GROCER may only ' +
      'target processing/shipped/delivered.',
  })
  @ApiOkResponse({ type: OrderResponseDto })
  @ApiConflictResponse({ description: 'Illegal status transition.' })
  updateStatus(
    @Req() req: AuthenticatedUserRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateOrderStatusDto,
  ): Promise<OrderResponseDto> {
    return this.ordersService.updateStatus(req.user, id, dto.status);
  }

  @Patch(':id/payment-status')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN)
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
