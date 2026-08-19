import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { ClientsController } from './clients.controller';
import { ClientsService } from './clients.service';
import { CustomerProvisioningService } from './customer-provisioning.service';
import { Client } from './entities/client.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Client]), forwardRef(() => AuthModule)],
  controllers: [ClientsController],
  providers: [ClientsService, CustomerProvisioningService],
  exports: [ClientsService, CustomerProvisioningService],
})
export class ClientsModule {}
