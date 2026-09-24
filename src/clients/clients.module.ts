import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { MailModule } from '../mail/mail.module';
import { ClientInvitationsService } from './client-invitations.service';
import { ClientsController } from './clients.controller';
import { ClientsService } from './clients.service';
import { ClientRecoveryService } from './client-recovery.service';
import { CustomerProvisioningService } from './customer-provisioning.service';
import { Client } from './entities/client.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([Client]),
    forwardRef(() => AuthModule),
    MailModule,
  ],
  controllers: [ClientsController],
  providers: [
    ClientsService,
    ClientInvitationsService,
    ClientRecoveryService,
    CustomerProvisioningService,
  ],
  exports: [ClientsService, ClientRecoveryService, CustomerProvisioningService],
})
export class ClientsModule {}
