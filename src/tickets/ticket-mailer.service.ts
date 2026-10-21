import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { MailService, SendResult } from '../mail/mail.service';
import { NomenclatorsService } from '../nomenclators/nomenclators.service';
import { User } from '../users/entities/user.entity';
import { Ticket } from './entities/ticket.entity';
import { ticketAsignado } from './ticket-mail';

export const PLANTILLA_TICKET_ASIGNADO = 'ticket_assigned';

/**
 * El aviso al compañero al que le toca un ticket (MxH-0065).
 *
 * **Nunca tumba la operación que lo llama.** Asignar un ticket queda asignado
 * aunque el correo no salga; el fallo queda en `email_log` con su mensaje.
 * Perder un aviso es malo, no poder asignar sería peor.
 *
 * **Y es un correo prescindible a efectos de cupo.** El plan de Resend tiene
 * tope mensual y diario, con una reserva para lo esencial — lo que se le manda
 * a quien acaba de pagar o está esperando su pedido. Un aviso interno no puede
 * competir con eso: se declara en `MAIL_TEMPLATES_LOW_PRIORITY`, así que deja
 * de salir antes de rozar la reserva y el equipo se enterará por el panel, que
 * es donde trabaja de todos modos.
 */
@Injectable()
export class TicketMailerService {
  private readonly logger = new Logger(TicketMailerService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly mail: MailService,
    private readonly nomenclatorsService: NomenclatorsService,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) {}

  async avisarAsignado(ticket: Ticket): Promise<SendResult | null> {
    if (!ticket.assignedUserId) return null;

    try {
      const asignado = await this.userRepository.findOne({
        where: { id: ticket.assignedUserId },
      });
      const to = asignado?.email?.trim();
      if (!to) {
        this.logger.warn(
          `Ticket ${ticket.id}: el usuario asignado no tiene correo; no se avisa`,
        );
        return null;
      }

      const [etiquetas, autor] = await Promise.all([
        this.nomenclatorsService.labelsFor([ticket.categoryId]),
        this.userRepository.findOne({
          where: { id: ticket.createdByUserId },
        }),
      ]);

      const rendered = ticketAsignado({
        title: ticket.title,
        description: ticket.description,
        categoryLabel: etiquetas.get(ticket.categoryId) ?? null,
        priority: ticket.priority,
        openedBy: this.nombre(autor),
        assignedName: this.nombre(asignado),
        adminUrl: this.configService.get<string>('adminUrl') ?? null,
        ticketId: ticket.id,
      });

      return await this.mail.send({
        to,
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
        template: PLANTILLA_TICKET_ASIGNADO,
      });
    } catch (err) {
      // Asignar ya ocurrió; que el aviso falle no lo deshace.
      this.logger.error(
        `No se pudo avisar del ticket ${ticket.id}`,
        err instanceof Error ? err.stack : String(err),
      );
      return null;
    }
  }

  private nombre(usuario: User | null): string | null {
    if (!usuario) return null;
    return (
      [usuario.firstName, usuario.lastName].filter(Boolean).join(' ') ||
      usuario.email ||
      null
    );
  }
}
