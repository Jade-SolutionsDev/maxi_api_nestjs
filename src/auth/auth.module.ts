import { Module } from '@nestjs/common';
import { ClientsModule } from '../clients/clients.module';
import { UsersModule } from '../users/users.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { ClientAuthService } from './client-auth.service';
import { ClerkClientAuthGuard } from './guards/clerk-client-auth.guard';
import { ClerkUserAuthGuard } from './guards/clerk-user-auth.guard';

@Module({
  imports: [UsersModule, ClientsModule],
  controllers: [AuthController],
  providers: [
    AuthService,
    ClientAuthService,
    ClerkUserAuthGuard,
    ClerkClientAuthGuard,
  ],
  exports: [
    AuthService,
    ClientAuthService,
    ClerkUserAuthGuard,
    ClerkClientAuthGuard,
  ],
})
export class AuthModule {}
