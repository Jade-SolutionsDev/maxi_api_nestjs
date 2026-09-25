import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { CartModule } from '../cart/cart.module';
import { Client } from '../clients/entities/client.entity';
import { ClientAddressesModule } from '../client-addresses/client-addresses.module';
import { FulfillmentModule } from '../fulfillment/fulfillment.module';
import { GeographyModule } from '../geography/geography.module';
import { InventoryModule } from '../inventory/inventory.module';
import { PaymentsModule } from '../payments/payments.module';
import { CmsModule } from '../cms/cms.module';
import { MailModule } from '../mail/mail.module';
import { OrderEventsModule } from '../order-events/order-events.module';
import { UploadsModule } from '../uploads/uploads.module';
import { ProductsModule } from '../products/products.module';
import { OrderItem } from './entities/order-item.entity';
import { User } from '../users/entities/user.entity';
import { UserRole } from '../permissions/entities/user-role.entity';
import { Order } from './entities/order.entity';
import { OrdersController } from './orders.controller';
import { OrderPdfModule } from './order-pdf.module';
import { OrdersService } from './orders.service';
import { ReportMailerService } from './report-mailer.service';
import { ReportRecipientsService } from './report-recipients.service';
import { PermissionsModule } from '../permissions/permissions.module';
import { OrderTrackingController } from './order-tracking.controller';
import { StorefrontOrdersController } from './storefront-orders.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([Order, OrderItem, User, UserRole, Client]),
    forwardRef(() => AuthModule),
    CartModule,
    ClientAddressesModule,
    FulfillmentModule,
    GeographyModule,
    InventoryModule,
    PaymentsModule,
    UploadsModule,
    PermissionsModule,
    OrderEventsModule,
    MailModule,
    CmsModule,
    ProductsModule,
    OrderPdfModule,
  ],
  controllers: [
    OrdersController,
    StorefrontOrdersController,
    OrderTrackingController,
  ],
  providers: [OrdersService, ReportRecipientsService, ReportMailerService],
})
export class OrdersModule {}
