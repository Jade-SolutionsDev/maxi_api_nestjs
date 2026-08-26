import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { GeographyModule } from '../geography/geography.module';
import { ProductsModule } from '../products/products.module';
import { StockLocationPickupAddress } from '../stock-locations/entities/stock-location-pickup-address.entity';
import { DeliveryOptionsController } from './delivery-options.controller';
import { DeliveryOptionZone } from './entities/delivery-option-zone.entity';
import { DeliveryOption } from './entities/delivery-option.entity';
import { FulfillmentSettings } from './entities/fulfillment-settings.entity';
import { FulfillmentSettingsController } from './fulfillment-settings.controller';
import { FulfillmentService } from './fulfillment.service';
import { StorefrontFulfillmentController } from './storefront-fulfillment.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      DeliveryOption,
      DeliveryOptionZone,
      FulfillmentSettings,
      StockLocationPickupAddress,
    ]),
    forwardRef(() => AuthModule),
    GeographyModule,
    ProductsModule,
  ],
  controllers: [
    DeliveryOptionsController,
    FulfillmentSettingsController,
    StorefrontFulfillmentController,
  ],
  providers: [FulfillmentService],
  exports: [FulfillmentService],
})
export class FulfillmentModule {}
