import { Controller, Get, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../users/entities/user.entity';
import { DashboardService } from './dashboard.service';
import { DashboardStatsQueryDto } from './dto/dashboard-stats-query.dto';
import { DashboardStatsResponseDto } from './dto/dashboard-stats-response.dto';
import { DashboardTopProductsQueryDto } from './dto/dashboard-top-products-query.dto';
import { DashboardTopProductsResponseDto } from './dto/dashboard-top-products-response.dto';

/**
 * Business figures for the backoffice landing page. ADMIN and up only: three of
 * the four are commercial performance (revenue, orders, customers) and a GROCER
 * cannot read /clients at all, so admitting that role here would mean
 * conditional fields inside a single payload. A grocer's dashboard shows the
 * recent-orders table instead, which they can already read via GET /orders.
 */
@ApiTags('dashboard')
@ApiBearerAuth()
@Controller('dashboard')
@Roles(Role.SUPER_ADMIN, Role.ADMIN)
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get('stats')
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
  @ApiOperation({
    summary: 'Best-selling products for the admin dashboard',
    description:
      'Ranked by UNITS sold, not by revenue — a cheap item everyone buys ' +
      'outranks an expensive one that bills more. Cancelled and unpaid orders ' +
      'are excluded, matching the revenue convention. `days` defaults to 30 ' +
      'and `limit` to 5.',
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
