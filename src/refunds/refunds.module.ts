import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MailModule } from '../mail/mail.module';
import { OrderEventsModule } from '../order-events/order-events.module';
import { Order } from '../orders/entities/order.entity';
import { User } from '../users/entities/user.entity';
import { Refund } from './entities/refund.entity';
import {
  OrderRefundsController,
  RefundsController,
} from './refunds.controller';
import { RefundsService } from './refunds.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Refund, Order, User]),
    OrderEventsModule,
    MailModule,
  ],
  controllers: [RefundsController, OrderRefundsController],
  providers: [RefundsService],
  exports: [RefundsService],
})
export class RefundsModule {}
