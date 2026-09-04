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
      'it, so the caller can render a trend. `days` defaults to 30. Revenue ' +
      'excludes cancelled orders; the order count includes them.',
  })
  @ApiOkResponse({ type: DashboardStatsResponseDto })
  getStats(
    @Query() query: DashboardStatsQueryDto,
  ): Promise<DashboardStatsResponseDto> {
    return this.dashboardService.getStats(query.days ?? 30);
  }
}
