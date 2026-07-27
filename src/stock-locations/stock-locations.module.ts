import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { GeographyModule } from '../geography/geography.module';
import { User } from '../users/entities/user.entity';
import { StockLocation } from './entities/stock-location.entity';
import { StockLocationCoverage } from './entities/stock-location-coverage.entity';
import { StockLocationGrocer } from './entities/stock-location-grocer.entity';
import { StockLocationPickupAddress } from './entities/stock-location-pickup-address.entity';
import { StockLocationsController } from './stock-locations.controller';
import { StockLocationsService } from './stock-locations.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      StockLocation,
      StockLocationCoverage,
      StockLocationGrocer,
      StockLocationPickupAddress,
      User,
    ]),
    forwardRef(() => AuthModule),
    GeographyModule,
  ],
  controllers: [StockLocationsController],
  providers: [StockLocationsService],
  exports: [StockLocationsService],
})
export class StockLocationsModule {}
