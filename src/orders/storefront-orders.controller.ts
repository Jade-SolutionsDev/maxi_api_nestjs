import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { ClerkClientAuthGuard } from '../auth/guards/clerk-client-auth.guard';
import type { AuthenticatedClientRequest } from '../auth/types/authenticated-request';
import { Public } from '../common/decorators/public.decorator';
import {
  PaginatedResponse,
  PaginationQueryDto,
} from '../common/dto/pagination.dto';
import { CheckoutDto } from './dto/checkout.dto';
import { OrderResponseDto } from './dto/order-response.dto';
import { OrdersService } from './orders.service';

// Authenticated storefront orders (same guard pattern as the cart).
@ApiTags('storefront')
@ApiBearerAuth()
@Controller('storefront/orders')
@Public()
@UseGuards(ClerkClientAuthGuard)
export class StorefrontOrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Post()
  @ApiOperation({
    summary: 'Checkout: create an order from the cart',
    description:
      'Snapshots the cart (names + server-side prices) into a `pending` ' +
      'order, reserves the stock (it stops counting as available for other ' +
      'shoppers), and clears the cart. Payment starts `pending`; when a ' +
      'payment platform is integrated, `redirectUrl` will point to its ' +
      'hosted checkout.',
  })
  @ApiCreatedResponse({ type: OrderResponseDto })
  @ApiConflictResponse({
    description:
      'The cart is stale: some lines exceed current availability. ' +
      '`error.details[]` lists the offending products with `available`.',
  })
  checkout(
    @Req() req: AuthenticatedClientRequest,
    @Body() dto: CheckoutDto,
  ): Promise<OrderResponseDto> {
    return this.ordersService.checkout(req.client, dto);
  }

  @Get()
  @ApiOperation({ summary: "List the customer's orders (newest first)" })
  getOrders(
    @Req() req: AuthenticatedClientRequest,
    @Query() query: PaginationQueryDto,
  ): Promise<PaginatedResponse<OrderResponseDto>> {
    return this.ordersService.findForClient(
      req.client.id,
      query.page,
      query.limit,
    );
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get one of the customer’s orders' })
  @ApiOkResponse({ type: OrderResponseDto })
  getOrder(
    @Req() req: AuthenticatedClientRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<OrderResponseDto> {
    return this.ordersService.findOneForClient(req.client.id, id);
  }

  @Post(':id/cancel')
  @ApiOperation({
    summary: 'Cancel a pending order',
    description:
      'Only while `status` is `pending` (409 otherwise). Releases the stock ' +
      'reservation, so the units are sellable again.',
  })
  @ApiOkResponse({ type: OrderResponseDto })
  @ApiConflictResponse({ description: 'The order is no longer pending.' })
  cancel(
    @Req() req: AuthenticatedClientRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<OrderResponseDto> {
    return this.ordersService.cancelByClient(req.client.id, id);
  }
}
