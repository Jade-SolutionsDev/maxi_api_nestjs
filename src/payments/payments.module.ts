import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { InventoryModule } from '../inventory/inventory.module';
import { OrderItem } from '../orders/entities/order-item.entity';
import { Order } from '../orders/entities/order.entity';
import { PaymentCharge } from './entities/payment-charge.entity';
import { PaymentMethod } from './entities/payment-method.entity';
import { ManualGateway } from './gateways/manual/manual.gateway';
import { MibiClient } from './gateways/mibilletera/mibi-client';
import { MibilleteraGateway } from './gateways/mibilletera/mibilletera.gateway';
import { TropipayClient } from './gateways/tropipay/tropipay-client';
import { TropipayGateway } from './gateways/tropipay/tropipay.gateway';
import { OrderExpiryController } from './order-expiry.controller';
import { OrderExpiryService } from './order-expiry.service';
import { PaymentMethodsController } from './payment-methods.controller';
import { PaymentMethodsService } from './payment-methods.service';
import { PAYMENT_GATEWAYS } from './payment-gateway.interface';
import { PaymentsService } from './payments.service';
import { PaymentsWebhookController } from './payments-webhook.controller';
import { StorefrontPaymentMethodsController } from './storefront-payment-methods.controller';

/**
 * Every payment platform lives here. Adding one means: implement
 * PaymentGateway, list it in PAYMENT_GATEWAYS, add its credentials to
 * configuration — the catalog row, admin toggle, webhook route, checkout
 * option and storefront panel all come for free.
 *
 * Imports Order's repository but never OrdersModule, so there is no cycle.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([Order, OrderItem, PaymentCharge, PaymentMethod]),
    forwardRef(() => AuthModule),
    InventoryModule,
  ],
  controllers: [
    PaymentMethodsController,
    StorefrontPaymentMethodsController,
    PaymentsWebhookController,
    OrderExpiryController,
  ],
  providers: [
    PaymentsService,
    PaymentMethodsService,
    OrderExpiryService,
    MibiClient,
    TropipayClient,
    ManualGateway,
    MibilleteraGateway,
    TropipayGateway,
    {
      provide: PAYMENT_GATEWAYS,
      inject: [TropipayGateway, MibilleteraGateway, ManualGateway],
      useFactory: (...gateways: unknown[]) => gateways,
    },
  ],
  exports: [PaymentsService, PaymentMethodsService, OrderExpiryService],
})
export class PaymentsModule {}
