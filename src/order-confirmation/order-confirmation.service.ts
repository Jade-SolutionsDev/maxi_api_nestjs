import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { InventoryService } from '../inventory/inventory.service';
import { OrderEventKind } from '../order-events/entities/order-event.entity';
import { OrderEventsService } from '../order-events/order-events.service';
import {
  Order,
  OrderStatus,
  PaymentStatus,
} from '../orders/entities/order.entity';

/**
 * El pago confirma el pedido. `MxH-0170`.
 *
 * Antes confirmar era siempre un acto de una persona en el panel
 * (`D-048`): hasta que alguien pulsaba el botón, la mercancía seguía
 * **apartada** pero sin descontar del almacén. Jade decidió el 17-oct-2026 que
 * un pedido pagado no tiene por qué esperar a nadie.
 *
 * **Se confirma al cobrar y no al crear el pedido**, que era la otra lectura
 * de la tarjeta, por lo que pasa con lo que nunca se paga: el barrido de
 * caducidad solo alcanza a los pedidos `pending`, así que un pedido que naciera
 * confirmado jamás caducaría y su mercancía se quedaría descontada para
 * siempre. Cobrando primero, lo que no se paga sigue caducando y liberando
 * igual que hasta hoy.
 *
 * Vive aparte de `OrdersService` porque lo llaman los dos lados del cobro
 * —el panel y el webhook de la pasarela— y `PaymentsService` no puede depender
 * de `OrdersService`, que ya depende de él.
 */
@Injectable()
export class OrderConfirmationService {
  private readonly logger = new Logger(OrderConfirmationService.name);

  constructor(
    private readonly inventoryService: InventoryService,
    private readonly orderEvents: OrderEventsService,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * Confirma el pedido si el pago acaba de entrar y sigue esperando.
   *
   * Devuelve si confirmó, para que quien llama sepa si tiene que avisar del
   * cambio de estado. No confirma nada que no esté `pending`: un pedido
   * cancelado —o ya en reparto— no retrocede ni avanza por haberse cobrado.
   *
   * `userId` es quien marcó el cobro desde el panel, o `null` cuando lo
   * notificó la pasarela: entonces la salida de mercancía la firma el sistema.
   */
  async confirmarPorPago(
    order: Order,
    userId: string | null,
  ): Promise<boolean> {
    if (order.paymentStatus !== PaymentStatus.PAID) return false;
    if (order.status !== OrderStatus.PENDING) return false;

    try {
      await this.dataSource.transaction(async (manager) => {
        await this.inventoryService.confirmReservations(
          manager,
          order.id,
          userId,
        );
        order.status = OrderStatus.CONFIRMED;
        await manager.getRepository(Order).save(order);
        await this.orderEvents.record(manager, {
          orderId: order.id,
          kind: OrderEventKind.STATUS_CHANGED,
          actor: userId ? { userId } : { system: true },
          field: 'status',
          previousValue: OrderStatus.PENDING,
          nextValue: OrderStatus.CONFIRMED,
          reason: 'El pago confirmó el pedido',
        });
      });
      return true;
    } catch (error) {
      // El cobro ya está registrado y es lo que no puede perderse. Si la
      // confirmación falla —una fila de inventario bloqueada, por ejemplo—, el
      // pedido se queda pagado y pendiente, que es exactamente el estado
      // anterior a esta tarjeta, y alguien lo avanza desde el panel.
      this.logger.error(
        `El pago de ${order.id} no pudo confirmar el pedido: ` +
          (error instanceof Error ? error.message : String(error)),
      );
      return false;
    }
  }
}
