import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { ClientsController } from './clients.controller';
import { ClientsService } from './clients.service';
import { ClientRecoveryService } from './client-recovery.service';
import { CustomerProvisioningService } from './customer-provisioning.service';
import { Client } from './entities/client.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Client]), forwardRef(() => AuthModule)],
  controllers: [ClientsController],
  providers: [
    ClientsService,
    ClientRecoveryService,
    CustomerProvisioningService,
  ],
  exports: [ClientsService, ClientRecoveryService, CustomerProvisioningService],
})
export class ClientsModule {}
