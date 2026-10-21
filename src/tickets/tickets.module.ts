import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MailModule } from '../mail/mail.module';
import { NomenclatorsModule } from '../nomenclators/nomenclators.module';
import { User } from '../users/entities/user.entity';
import { TicketEvent } from './entities/ticket-event.entity';
import { Ticket } from './entities/ticket.entity';
import { TicketMailerService } from './ticket-mailer.service';
import { TicketsController } from './tickets.controller';
import { TicketsService } from './tickets.service';

/**
 * Las incidencias internas (MxH-0065).
 *
 * `MailModule` y `NomenclatorsModule` van declarados aquí aunque parezcan
 * lejanos: `TicketMailerService` pide `MailService` y `NomenclatorsService` por
 * el constructor, y Nest **no propaga los exports de un módulo importado**. Sin
 * estas dos líneas la API no arranca —`UnknownDependenciesException`— y
 * **ninguna prueba lo ve**, porque cada prueba unitaria le pasa los
 * proveedores a mano. Ya pasó antes en `MailModule` con `CmsModule`.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([Ticket, TicketEvent, User]),
    NomenclatorsModule,
    MailModule,
  ],
  controllers: [TicketsController],
  providers: [TicketsService, TicketMailerService],
  exports: [TicketsService],
})
export class TicketsModule {}
