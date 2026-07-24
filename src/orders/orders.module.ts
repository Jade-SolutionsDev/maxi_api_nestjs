import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { CartModule } from '../cart/cart.module';
import { InventoryModule } from '../inventory/inventory.module';
import { OrderItem } from './entities/order-item.entity';
import { Order } from './entities/order.entity';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { StorefrontOrdersController } from './storefront-orders.controller';
import { ManualPaymentProvider } from './payments/manual-payment.provider';
import { PAYMENT_PROVIDER } from './payments/payment-provider.interface';

@Module({
  imports: [
    TypeOrmModule.forFeature([Order, OrderItem]),
    forwardRef(() => AuthModule),
    CartModule,
    InventoryModule,
  ],
  controllers: [OrdersController, StorefrontOrdersController],
  providers: [
    OrdersService,
    ManualPaymentProvider,
    // Payment platform undecided: bind the manual provider. Swap this binding
    // (or make it a config-driven factory like AUTH_PROVIDER) when a gateway
    // is chosen.
    { provide: PAYMENT_PROVIDER, useExisting: ManualPaymentProvider },
  ],
})
export class OrdersModule {}
