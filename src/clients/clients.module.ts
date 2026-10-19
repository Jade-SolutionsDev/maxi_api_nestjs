import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { ClientAddressesModule } from '../client-addresses/client-addresses.module';
import { MailModule } from '../mail/mail.module';
import { ClientInvitationsService } from './client-invitations.service';
import { ClientsController } from './clients.controller';
import { ClientsService } from './clients.service';
import { ClientReconciliationService } from './client-reconciliation.service';
import { ClientRecoveryService } from './client-recovery.service';
import { CustomerProvisioningService } from './customer-provisioning.service';
import { Client } from './entities/client.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([Client]),
    forwardRef(() => AuthModule),
    // Para la libreta de direcciones del detalle del cliente (MxH-0178).
    // `forwardRef` porque este módulo ya está en un ciclo con AuthModule, y
    // ClientAddressesModule también importa AuthModule: sin él, el orden de
    // resolución depende de por dónde entre Nest.
    forwardRef(() => ClientAddressesModule),
    MailModule,
  ],
  controllers: [ClientsController],
  providers: [
    ClientsService,
    ClientInvitationsService,
    ClientReconciliationService,
    ClientRecoveryService,
    CustomerProvisioningService,
  ],
  exports: [ClientsService, ClientRecoveryService, CustomerProvisioningService],
})
export class ClientsModule {}
