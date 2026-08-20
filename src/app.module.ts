import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
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
import { ClientsModule } from './clients/clients.module';
import { AuthGuard } from './common/guards/auth.guard';
import { RolesGuard } from './common/guards/roles.guard';
import { GeographyModule } from './geography/geography.module';
import { HealthModule } from './health/health.module';
import { InventoryModule } from './inventory/inventory.module';
import { OrdersModule } from './orders/orders.module';
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
    ThrottlerModule.forRoot({
      throttlers: [{ ttl: 60_000, limit: 120 }],
      skipIf: () => process.env.NODE_ENV === 'test',
    }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const { url } = databaseConfig();
        const nodeEnv = configService.get<string>('nodeEnv');
        return {
          type: 'postgres',
          url,
          autoLoadEntities: true,
          synchronize: nodeEnv !== 'production',
          logging: false,
        };
      },
    }),
    HealthModule,
    RevalidationModule,
    UsersModule,
    ClientsModule,
    AuthModule,
    CategoriesModule,
    CmsModule,
    ProductsModule,
    CartModule,
    GeographyModule,
    StockLocationsModule,
    InventoryModule,
    OrdersModule,
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
