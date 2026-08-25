import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { Nomenclator } from './entities/nomenclator.entity';
import { NomenclatorsController } from './nomenclators.controller';
import { NomenclatorsService } from './nomenclators.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Nomenclator]),
    forwardRef(() => AuthModule),
  ],
  controllers: [NomenclatorsController],
  providers: [NomenclatorsService],
  exports: [NomenclatorsService],
})
export class NomenclatorsModule {}
