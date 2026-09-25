import { Controller, Get, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { RequirePermission } from '../permissions/decorators/require-permission.decorator';
import { DashboardService } from './dashboard.service';
import { DashboardStatsQueryDto } from './dto/dashboard-stats-query.dto';
import { DashboardStatsResponseDto } from './dto/dashboard-stats-response.dto';
import { DashboardTopProductsQueryDto } from './dto/dashboard-top-products-query.dto';
import { DashboardTopProductsResponseDto } from './dto/dashboard-top-products-response.dto';

/**
 * Business figures for the backoffice landing page, behind `dashboard:view`
 * (admins bypass; no base role is granted it). The payload mixes commercial
 * performance (revenue, orders, customers), so grant the permission only to
 * roles that may read those figures — an ungranted user's dashboard shows the
 * recent-orders table instead, gated by its own `orders:list`.
 */
@ApiTags('dashboard')
@ApiBearerAuth()
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get('stats')
  @RequirePermission({ module: 'dashboard', action: 'view' })
  @ApiOperation({
    summary: 'KPI figures for the admin dashboard',
    description:
      'Every metric carries the current window and the one immediately before ' +
      'it, so the caller can render a trend. `days` defaults to 30. Revenue is ' +
      'money COLLECTED: it excludes cancelled orders and counts only those ' +
      'with `payment_status = paid`. The order count ignores both filters — it ' +
      'measures demand, not money.',
  })
  @ApiOkResponse({ type: DashboardStatsResponseDto })
  getStats(
    @Query() query: DashboardStatsQueryDto,
  ): Promise<DashboardStatsResponseDto> {
    return this.dashboardService.getStats(query.days ?? 30);
  }

  @Get('top-products')
  @RequirePermission({ module: 'dashboard', action: 'view' })
  @ApiOperation({
    summary: 'Best-selling products for the admin dashboard',
    description:
      'Ranked by UNITS sold, not by revenue — a cheap item everyone buys ' +
      'outranks an expensive one that bills more. Each row also carries the ' +
      '`revenue` that product billed in the window, at the prices charged when ' +
      'each order was placed; it is reported, never ranked on. Delivery fees ' +
      'belong to the order rather than to any product, so these figures add up ' +
      'to less than the `revenue` KPI on /dashboard/stats. Cancelled and ' +
      'unpaid orders are excluded from both columns, matching the revenue ' +
      'convention. `days` defaults to 30 and `limit` to 5.',
  })
  @ApiOkResponse({ type: DashboardTopProductsResponseDto })
  getTopProducts(
    @Query() query: DashboardTopProductsQueryDto,
  ): Promise<DashboardTopProductsResponseDto> {
    return this.dashboardService.getTopProducts(
      query.days ?? 30,
      query.limit ?? 5,
    );
  }
}
