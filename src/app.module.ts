import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import configuration, { databaseConfig } from './config/configuration';
import { AuthModule } from './auth/auth.module';
import { CartModule } from './cart/cart.module';
import { CategoriesModule } from './categories/categories.module';
import { CmsModule } from './cms/cms.module';
import { ClientAddressesModule } from './client-addresses/client-addresses.module';
import { ClientsModule } from './clients/clients.module';
import { ContactModule } from './contact/contact.module';
import { AuthGuard } from './common/guards/auth.guard';
import { RolesGuard } from './common/guards/roles.guard';
import { FulfillmentModule } from './fulfillment/fulfillment.module';
import { GeographyModule } from './geography/geography.module';
import { HealthModule } from './health/health.module';
import { InventoryModule } from './inventory/inventory.module';
import { NomenclatorsModule } from './nomenclators/nomenclators.module';
import { OrdersModule } from './orders/orders.module';
import { PaymentsModule } from './payments/payments.module';
import { PermissionGuard } from './permissions/guards/permission.guard';
import { PermissionsModule } from './permissions/permissions.module';
import { ProductsModule } from './products/products.module';
import { RevalidationModule } from './revalidation/revalidation.module';
import { StockLocationsModule } from './stock-locations/stock-locations.module';
import { UploadsModule } from './uploads/uploads.module';
import { UsersModule } from './users/users.module';
import { WebhooksModule } from './webhooks/webhooks.module';

@Module({
  imports: [
    ConfigModule.forRoot({ load: [configuration], isGlobal: true }),
    // Global rate limiting (MxH-0066). Generous default; sensitive routes tighten
    // it with @Throttle (see STRICT_THROTTLE). Skipped under test to keep e2e
    // runs, which fire many requests from one IP, deterministic.
    // THROTTLE_DISABLED=true is the explicit LOCAL opt-out: on one machine every
    // app shares 127.0.0.1's bucket and dev traffic trips the limit. Deployed
    // environments never set it, so the control stays fail-safe (default-on,
    // no NODE_ENV dependency — the fail-open class MxH-0076 removed).
    ThrottlerModule.forRoot({
      throttlers: [{ ttl: 60_000, limit: 120 }],
      skipIf: () =>
        process.env.NODE_ENV === 'test' ||
        process.env.THROTTLE_DISABLED === 'true',
    }),
    TypeOrmModule.forRootAsync({
      useFactory: () => {
        const { url } = databaseConfig();
        return {
          type: 'postgres',
          url,
          autoLoadEntities: true,
          // No environment syncs from the entities any more. `synchronize`
          // silently altered whatever schema it found, which is how production
          // and development drifted apart in the first place — and it can drop
          // columns to make the schema match. Every change now travels as a
          // committed migration, applied in order at boot.
          //
          // The glob covers both runtimes: __dirname is src/ under ts-node
          // (dev, e2e) and dist/ once compiled.
          synchronize: false,
          migrations: [`${__dirname}/database/migrations/*{.ts,.js}`],
          migrationsRun: true,
          logging: false,
        };
      },
    }),
    HealthModule,
    RevalidationModule,
    UsersModule,
    ClientsModule,
    ClientAddressesModule,
    AuthModule,
    CategoriesModule,
    CmsModule,
    NomenclatorsModule,
    ContactModule,
    ProductsModule,
    CartModule,
    GeographyModule,
    FulfillmentModule,
    StockLocationsModule,
    InventoryModule,
    OrdersModule,
    PaymentsModule,
    UploadsModule,
    WebhooksModule,
    PermissionsModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    // Rate limit first, before any auth work runs.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    // Order matters: AuthGuard populates request.user, then RolesGuard checks the
    // enum tier, then PermissionGuard checks @RequirePermission (managed roles).
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: PermissionGuard },
  ],
})
export class AppModule {}
