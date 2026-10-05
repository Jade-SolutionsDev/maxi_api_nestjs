import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CmsModule } from '../cms/cms.module';
import { Order } from '../orders/entities/order.entity';
import { OrderPdfModule } from '../orders/order-pdf.module';
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
  // OrderPdfModule, no OrdersModule: el comprobante sin arrastrar los
  // pedidos enteros, que importan este módulo y cerrarían el círculo.
  //
  // CmsModule tiene que estar aquí aunque OrderPdfModule ya lo importe: Nest no
  // propaga los exports de un módulo importado, así que `CmsService` llegaba a
  // `OrderPdfService` y no a `OrderMailerService`. Sin esta línea la API no
  // arranca —`UnknownDependenciesException`—, y las pruebas unitarias no lo ven
  // porque cada una le pasa el proveedor a mano.
  imports: [
    TypeOrmModule.forFeature([EmailLog, Order]),
    OrderPdfModule,
    CmsModule,
  ],
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
