import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { Order } from '../orders/entities/order.entity';
import { PaymentCharge } from './entities/payment-charge.entity';
import { PaymentMethod } from './entities/payment-method.entity';
import { ManualGateway } from './gateways/manual/manual.gateway';
import { MibiClient } from './gateways/mibilletera/mibi-client';
import { MibilleteraGateway } from './gateways/mibilletera/mibilletera.gateway';
import { TropipayClient } from './gateways/tropipay/tropipay-client';
import { TropipayGateway } from './gateways/tropipay/tropipay.gateway';
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
    TypeOrmModule.forFeature([Order, PaymentCharge, PaymentMethod]),
    forwardRef(() => AuthModule),
  ],
  controllers: [
    PaymentMethodsController,
    StorefrontPaymentMethodsController,
    PaymentsWebhookController,
  ],
  providers: [
    PaymentsService,
    PaymentMethodsService,
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
  exports: [PaymentsService, PaymentMethodsService],
})
export class PaymentsModule {}
