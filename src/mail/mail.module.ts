import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Order } from '../orders/entities/order.entity';
import { EmailLog } from './entities/email-log.entity';
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
  providers: [MailService, OrderMailerService, PickupRemindersService],
  exports: [MailService, OrderMailerService],
})
export class MailModule {}
