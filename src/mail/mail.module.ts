import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Order } from '../orders/entities/order.entity';
import { EmailLog } from './entities/email-log.entity';
import { ClientMailerService } from './client-mailer.service';
import { MailService } from './mail.service';
import { OrderMailerService } from './order-mailer.service';
import { PickupRemindersController } from './pickup-reminders.controller';
import { PickupRemindersService } from './pickup-reminders.service';

/**
 * Correo saliente: el transporte (Resend), las plantillas y el registro de lo
 * enviado. Cualquier módulo que necesite avisar al cliente importa este.
 */
@Module({
  imports: [TypeOrmModule.forFeature([EmailLog, Order])],
  controllers: [PickupRemindersController],
  providers: [
    MailService,
    OrderMailerService,
    ClientMailerService,
    PickupRemindersService,
  ],
  exports: [MailService, OrderMailerService, ClientMailerService],
})
export class MailModule {}
