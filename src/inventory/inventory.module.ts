import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { Product } from '../products/entities/product.entity';
import { StockLocationsModule } from '../stock-locations/stock-locations.module';
import { Inventory } from './entities/inventory.entity';
import { InventoryOperation } from './entities/inventory-operation.entity';
import { InventoryOperationItem } from './entities/inventory-operation-item.entity';
import { InventoryController } from './inventory.controller';
import { InventoryService } from './inventory.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Inventory,
      InventoryOperation,
      InventoryOperationItem,
      Product,
    ]),
    forwardRef(() => AuthModule),
    StockLocationsModule,
  ],
  controllers: [InventoryController],
  providers: [InventoryService],
  exports: [InventoryService],
})
export class InventoryModule {}
