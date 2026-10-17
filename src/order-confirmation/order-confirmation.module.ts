import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { InventoryModule } from '../inventory/inventory.module';
import { OrderEventsModule } from '../order-events/order-events.module';
import { Order } from '../orders/entities/order.entity';
import { OrderConfirmationService } from './order-confirmation.service';

/**
 * Módulo propio, y no una pieza de `OrdersModule`, porque lo usan los dos
 * lados del cobro: el panel (`OrdersModule`) y el webhook de la pasarela
 * (`PaymentsModule`). `OrdersModule` ya importa `PaymentsModule`, así que
 * colgarlo de allí habría cerrado un ciclo entre módulos.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([Order]),
    InventoryModule,
    OrderEventsModule,
  ],
  providers: [OrderConfirmationService],
  exports: [OrderConfirmationService],
})
export class OrderConfirmationModule {}
