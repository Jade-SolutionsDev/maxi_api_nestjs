import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GeographyController } from './geography.controller';
import { GeographyService } from './geography.service';
import { Municipality } from './entities/municipality.entity';
import { Province } from './entities/province.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Province, Municipality])],
  controllers: [GeographyController],
  providers: [GeographyService],
  exports: [GeographyService],
})
export class GeographyModule {}
