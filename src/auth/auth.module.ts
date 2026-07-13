import { forwardRef, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClientsModule } from '../clients/clients.module';
import { PermissionsModule } from '../permissions/permissions.module';
import { UsersModule } from '../users/users.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { ClientAuthService } from './client-auth.service';
import { ClerkClientAuthGuard } from './guards/clerk-client-auth.guard';
import { AUTH_PROVIDER } from './interfaces/auth-provider.interface';
import { ClerkAuthProvider } from './providers/clerk-auth.provider';
import { MockAuthProvider } from './providers/mock-auth.provider';

@Module({
  imports: [
    forwardRef(() => UsersModule),
    forwardRef(() => ClientsModule),
    PermissionsModule,
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    ClientAuthService,
    ClerkClientAuthGuard,
    ClerkAuthProvider,
    MockAuthProvider,
    {
      provide: AUTH_PROVIDER,
      inject: [ConfigService, MockAuthProvider, ClerkAuthProvider],
      useFactory: (
        configService: ConfigService,
        mock: MockAuthProvider,
        clerk: ClerkAuthProvider,
      ) => (configService.get<boolean>('auth.mockEnabled') ? mock : clerk),
    },
  ],
  exports: [
    AuthService,
    ClientAuthService,
    ClerkClientAuthGuard,
    AUTH_PROVIDER,
  ],
})
export class AuthModule {}
