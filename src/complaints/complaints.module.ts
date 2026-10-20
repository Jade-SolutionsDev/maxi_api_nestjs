import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Client } from '../clients/entities/client.entity';
import { NomenclatorsModule } from '../nomenclators/nomenclators.module';
import { Order } from '../orders/entities/order.entity';
import { User } from '../users/entities/user.entity';
import { ComplaintsController } from './complaints.controller';
import { ComplaintsService } from './complaints.service';
import { ComplaintEvent } from './entities/complaint-event.entity';
import { Complaint } from './entities/complaint.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([Complaint, ComplaintEvent, Client, Order, User]),
    NomenclatorsModule,
  ],
  controllers: [ComplaintsController],
  providers: [ComplaintsService],
  exports: [ComplaintsService],
})
export class ComplaintsModule {}
