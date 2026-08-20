import { Module, forwardRef } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { CartModule } from '../cart/cart.module';
import { InventoryModule } from '../inventory/inventory.module';
import { OrderItem } from './entities/order-item.entity';
import { Order } from './entities/order.entity';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { StorefrontOrdersController } from './storefront-orders.controller';
import { PaymentCharge } from './payments/entities/payment-charge.entity';
import { ManualPaymentProvider } from './payments/manual-payment.provider';
import { MibiClient } from './payments/mibi-client';
import { MibiPaymentProvider } from './payments/mibi-payment.provider';
import { MibiPaymentService } from './payments/mibi-payment.service';
import { MibiWebhookController } from './payments/mibi-webhook.controller';
import { PAYMENT_PROVIDER } from './payments/payment-provider.interface';

@Module({
  imports: [
    TypeOrmModule.forFeature([Order, OrderItem, PaymentCharge]),
    forwardRef(() => AuthModule),
    CartModule,
    InventoryModule,
  ],
  controllers: [
    OrdersController,
    StorefrontOrdersController,
    MibiWebhookController,
  ],
  providers: [
    OrdersService,
    ManualPaymentProvider,
    MibiClient,
    MibiPaymentService,
    MibiPaymentProvider,
    // Config-driven binding (same pattern as AUTH_PROVIDER): Mi Billetera when
    // the API keys are configured, otherwise the manual fallback (payments
    // settled by an admin).
    {
      provide: PAYMENT_PROVIDER,
      inject: [ConfigService, ManualPaymentProvider, MibiPaymentProvider],
      useFactory: (
        configService: ConfigService,
        manual: ManualPaymentProvider,
        mibi: MibiPaymentProvider,
      ) => (configService.get<boolean>('mibi.enabled') ? mibi : manual),
    },
  ],
})
export class OrdersModule {}
