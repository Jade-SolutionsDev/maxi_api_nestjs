import { Module } from '@nestjs/common';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';

/**
 * Read-only aggregation over orders/products/clients. No TypeOrmModule.forFeature:
 * the service owns no entity lifecycle, it only runs scalar aggregate SQL through
 * the root DataSource that TypeOrmModule.forRootAsync already provides.
 */
@Module({
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
