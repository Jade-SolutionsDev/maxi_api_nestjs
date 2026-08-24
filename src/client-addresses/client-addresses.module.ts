import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { GeographyModule } from '../geography/geography.module';
import { ClientAddressesController } from './client-addresses.controller';
import { ClientAddressesService } from './client-addresses.service';
import { ClientAddress } from './entities/client-address.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([ClientAddress]),
    forwardRef(() => AuthModule),
    GeographyModule,
  ],
  controllers: [ClientAddressesController],
  providers: [ClientAddressesService],
  exports: [ClientAddressesService],
})
export class ClientAddressesModule {}
