import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SupportConfig } from '../config/configuration';
import { Order } from '../orders/entities/order.entity';
import { MailService, SendResult } from './mail.service';
import {
  MotivoCancelacion,
  OrderMailData,
  RefundMailData,
  RenderedEmail,
  orderCancelled,
  orderDelivered,
  orderShipped,
  paymentReceived,
  pickupReminder,
  refundCompleted,
  refundRequested,
} from './templates';

/**
 * Los correos que dependen de un pedido. Carga el pedido con su cliente, arma
 * los datos que las plantillas necesitan y manda.
 *
 * Quien llama pasa solo el id: así ningún sitio tiene que acordarse de cargar
 * la relación del cliente antes de avisar.
 */
@Injectable()
export class OrderMailerService {
  private readonly logger = new Logger(OrderMailerService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly mail: MailService,
    @InjectRepository(Order)
    private readonly orderRepository: Repository<Order>,
  ) {}

  get configured(): boolean {
    return this.mail.configured;
  }

  async paymentReceived(orderId: string): Promise<SendResult | null> {
    return this.dispatch(orderId, 'payment_received', (data) =>
      paymentReceived(data),
    );
  }

  /**
   * Los cambios de estado que el cliente nota. **No están los seis a
   * propósito:** de `confirmed` y `processing` no se avisa, porque el cliente
   * acaba de recibir el correo del pago y tres avisos en una hora es la forma
   * más rápida de que marque la tienda como spam.
   */
  async shipped(orderId: string): Promise<SendResult | null> {
    return this.dispatch(orderId, 'order_shipped', (data) =>
      orderShipped(data),
    );
  }

  async delivered(orderId: string): Promise<SendResult | null> {
    return this.dispatch(orderId, 'order_delivered', (data) =>
      orderDelivered(data),
    );
  }

  /** El motivo elige el texto; `null` es la cancelación ordinaria. */
  async cancelled(
    orderId: string,
    motivo: MotivoCancelacion = null,
  ): Promise<SendResult | null> {
    return this.dispatch(orderId, 'order_cancelled', (data) =>
      orderCancelled(data, motivo),
    );
  }

  /** Recordatorio de custodia. La plantilla lleva el hito en la clave. */
  async pickupReminder(
    orderId: string,
    daysSincePayment: number,
  ): Promise<SendResult | null> {
    return this.dispatch(
      orderId,
      `pickup_reminder_${daysSincePayment}`,
      (data) => pickupReminder(data, daysSincePayment),
    );
  }

  async refundRequested(
    orderId: string,
    refund: RefundMailData,
  ): Promise<SendResult | null> {
    return this.dispatch(orderId, 'refund_requested', (data) =>
      refundRequested(data, refund),
    );
  }

  async refundCompleted(
    orderId: string,
    refund: RefundMailData,
  ): Promise<SendResult | null> {
    return this.dispatch(orderId, 'refund_completed', (data) =>
      refundCompleted(data, refund),
    );
  }

  private async dispatch(
    orderId: string,
    template: string,
    render: (data: OrderMailData) => RenderedEmail,
  ): Promise<SendResult | null> {
    try {
      const order = await this.orderRepository.findOne({
        where: { id: orderId },
        relations: { client: true },
      });
      if (!order) {
        this.logger.warn(
          `Correo "${template}": el pedido ${orderId} no existe`,
        );
        return null;
      }
      const to = this.recipient(order);
      if (!to) {
        this.logger.warn(
          `Correo "${template}": el pedido ${order.orderNumber ?? orderId} no tiene dirección de correo`,
        );
        return null;
      }
      const rendered = render(this.toMailData(order));
      return await this.mail.send({
        to,
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
        template,
        orderId: order.id,
      });
    } catch (err) {
      // Avisar nunca puede tumbar lo que se estaba haciendo.
      this.logger.error(
        `Correo "${template}" falló para el pedido ${orderId}`,
        err instanceof Error ? err.stack : String(err),
      );
      return null;
    }
  }

  /** Quien compró. El beneficiario que recoge no recibe estos correos. */
  private recipient(order: Order): string | null {
    const fromClient = order.client?.email?.trim();
    if (fromClient) {
      return fromClient;
    }
    const contact = order.contactSnapshot as { email?: string } | null;
    return contact?.email?.trim() || null;
  }

  private toMailData(order: Order): OrderMailData {
    const client = order.client;
    const name =
      [client?.firstName, client?.lastName].filter(Boolean).join(' ').trim() ||
      null;
    return {
      orderNumber: order.orderNumber ?? order.id,
      customerName: name,
      total: order.total,
      currency: 'USD',
      pickupAddress: this.pickupAddress(order),
      whatsapp:
        this.configService.get<SupportConfig>('support')?.whatsapp ?? '',
      storeUrl: null,
    };
  }

  /** `{locationName, label, address}` tal como lo guarda el checkout. */
  private pickupAddress(order: Order): string | null {
    const snapshot = order.pickupAddressSnapshot as {
      locationName?: string;
      label?: string;
      address?: string;
    } | null;
    if (!snapshot) {
      return null;
    }
    const parts = [snapshot.locationName, snapshot.label, snapshot.address]
      .map((part) => part?.trim())
      .filter((part): part is string => Boolean(part));
    return parts.length ? [...new Set(parts)].join(' · ') : null;
  }
}
