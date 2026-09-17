import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Not, Repository } from 'typeorm';
import {
  FulfillmentType,
  Order,
  OrderStatus,
  PaymentStatus,
} from '../orders/entities/order.entity';
import { EmailLog, EmailStatus } from './entities/email-log.entity';
import { OrderMailerService } from './order-mailer.service';
import { PICKUP_CUSTODY_DAYS, PICKUP_REMINDER_DAYS } from './templates';

export interface ReminderSweepResult {
  /** Correos enviados en esta pasada, por hito. */
  sent: Record<string, number>;
  /** Pedidos que cumplían el hito pero no tenían a quién escribir. */
  skipped: number;
}

/**
 * Avisa a quien pagó y todavía no ha recogido, a los 15 y a los 25 días.
 *
 * El candado es `email_log`, no el reloj: se busca «pagado hace 15 días o más
 * y sin recordatorio de 15 días enviado». Así, si la pasada de un día no corre
 * —el contenedor estaba caído, la clave de Resend faltaba— esa cohorte recibe
 * su aviso al día siguiente en vez de perderlo para siempre. Esos avisos son
 * lo que sostiene la cláusula de custodia: si no salen, no se puede invocar.
 */
@Injectable()
export class PickupRemindersService {
  private readonly logger = new Logger(PickupRemindersService.name);

  constructor(
    @InjectRepository(Order)
    private readonly orderRepository: Repository<Order>,
    @InjectRepository(EmailLog)
    private readonly emailLogRepository: Repository<EmailLog>,
    private readonly mailer: OrderMailerService,
  ) {}

  async sweep(now: Date = new Date()): Promise<ReminderSweepResult> {
    const result: ReminderSweepResult = { sent: {}, skipped: 0 };
    if (!this.mailer.configured) {
      this.logger.warn(
        'Recordatorios de recogida: no hay correo configurado, no se envía nada',
      );
      return result;
    }

    for (const milestone of PICKUP_REMINDER_DAYS) {
      const template = `pickup_reminder_${milestone}`;
      const cutoff = new Date(now.getTime() - milestone * 24 * 60 * 60 * 1000);
      const custodyFloor = new Date(
        now.getTime() - PICKUP_CUSTODY_DAYS * 24 * 60 * 60 * 1000,
      );
      const candidates = await this.orderRepository
        .createQueryBuilder('order')
        .where('order.payment_status = :paid', { paid: PaymentStatus.PAID })
        .andWhere('order.fulfillment_type = :pickup', {
          pickup: FulfillmentType.PICKUP,
        })
        .andWhere('order.status NOT IN (:...done)', {
          done: [OrderStatus.DELIVERED, OrderStatus.CANCELLED],
        })
        .andWhere('order.delivered_at IS NULL')
        .andWhere('order.paid_at IS NOT NULL')
        .andWhere('order.paid_at <= :cutoff', { cutoff })
        // Pasada la custodia ya no se recuerda nada: el aviso serviría de poco,
        // y evita que un pedido antiguo reciba hoy los dos recordatorios de
        // golpe por haberse rellenado su fecha de pago hacia atrás.
        .andWhere('order.paid_at > :custodyFloor', { custodyFloor })
        // Pasada la custodia ya no se recuerda nada: el aviso serviría de poco
        // y evita que un pedido viejo reciba hoy los dos recordatorios de
        // golpe cuando se rellenó su fecha de pago hacia atrás.
        .andWhere('order.paid_at > :custodyFloor', { custodyFloor })
        .andWhere(
          `NOT EXISTS (
             SELECT 1 FROM email_log log
             WHERE log.order_id = order.id
               AND log.template = :template
               AND log.status = :sent
           )`,
          { template, sent: EmailStatus.SENT },
        )
        .getMany();

      let count = 0;
      for (const order of candidates) {
        const outcome = await this.mailer.pickupReminder(order.id, milestone);
        if (outcome?.status === EmailStatus.SENT) {
          count += 1;
        } else {
          result.skipped += 1;
        }
      }
      result.sent[template] = count;
      if (count) {
        this.logger.log(
          `Recordatorios de ${milestone} días enviados: ${count}`,
        );
      }
    }
    return result;
  }

  /** Pedidos pagados que siguen sin recogerse, para la vista de administración. */
  async pendingPickups(): Promise<Order[]> {
    return this.orderRepository.find({
      where: {
        paymentStatus: PaymentStatus.PAID,
        fulfillmentType: FulfillmentType.PICKUP,
        deliveredAt: IsNull(),
        paidAt: Not(IsNull()),
      },
      order: { paidAt: 'ASC' },
    });
  }
}
