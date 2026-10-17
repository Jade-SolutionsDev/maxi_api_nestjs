import { Test, TestingModule } from '@nestjs/testing';
import { DataSource, EntityManager } from 'typeorm';

import { InventoryService } from '../inventory/inventory.service';
import { OrderEventsService } from '../order-events/order-events.service';
import {
  Order,
  OrderStatus,
  PaymentStatus,
} from '../orders/entities/order.entity';
import { OrderConfirmationService } from './order-confirmation.service';

describe('OrderConfirmationService', () => {
  let service: OrderConfirmationService;
  let inventory: { confirmReservations: jest.Mock };
  let eventos: { record: jest.Mock };
  let guardado: jest.Mock;

  const pedido = (cambios: Partial<Order> = {}): Order =>
    ({
      id: 'ord-1',
      status: OrderStatus.PENDING,
      paymentStatus: PaymentStatus.PAID,
      ...cambios,
    }) as Order;

  beforeEach(async () => {
    inventory = { confirmReservations: jest.fn().mockResolvedValue(undefined) };
    eventos = { record: jest.fn().mockResolvedValue(undefined) };
    guardado = jest.fn().mockResolvedValue(undefined);

    const manager = {
      getRepository: () => ({ save: guardado }),
    } as unknown as EntityManager;
    const dataSource = {
      transaction: jest.fn((cb: (m: EntityManager) => unknown) => cb(manager)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrderConfirmationService,
        { provide: InventoryService, useValue: inventory },
        { provide: OrderEventsService, useValue: eventos },
        { provide: DataSource, useValue: dataSource },
      ],
    }).compile();

    service = module.get(OrderConfirmationService);
  });

  it('un pedido pagado y pendiente queda confirmado y descuenta el stock', async () => {
    const order = pedido();

    await expect(service.confirmarPorPago(order, 'user-1')).resolves.toBe(true);

    expect(inventory.confirmReservations).toHaveBeenCalledWith(
      expect.anything(),
      'ord-1',
      'user-1',
    );
    expect(order.status).toBe(OrderStatus.CONFIRMED);
    expect(guardado).toHaveBeenCalled();
  });

  it('el webhook firma la salida como sistema, sin usuario', async () => {
    await service.confirmarPorPago(pedido(), null);

    expect(inventory.confirmReservations).toHaveBeenCalledWith(
      expect.anything(),
      'ord-1',
      null,
    );
    expect(eventos.record).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ actor: { system: true } }),
    );
  });

  it('un pedido sin pagar no se confirma', async () => {
    const order = pedido({ paymentStatus: PaymentStatus.PENDING });

    await expect(service.confirmarPorPago(order, 'user-1')).resolves.toBe(
      false,
    );

    expect(inventory.confirmReservations).not.toHaveBeenCalled();
    expect(order.status).toBe(OrderStatus.PENDING);
  });

  it('un pedido cancelado no resucita por cobrarse', async () => {
    // Pasa de verdad: un pago que llega después de que la reserva caducara y
    // ya no hay mercancía. Ese pedido se devuelve, no se sirve.
    const order = pedido({ status: OrderStatus.CANCELLED });

    await expect(service.confirmarPorPago(order, null)).resolves.toBe(false);

    expect(inventory.confirmReservations).not.toHaveBeenCalled();
    expect(order.status).toBe(OrderStatus.CANCELLED);
  });

  it('un pedido que ya avanzó no retrocede a confirmado', async () => {
    for (const status of [
      OrderStatus.CONFIRMED,
      OrderStatus.PROCESSING,
      OrderStatus.SHIPPED,
      OrderStatus.DELIVERED,
    ]) {
      const order = pedido({ status });

      await expect(service.confirmarPorPago(order, null)).resolves.toBe(false);

      expect(order.status).toBe(status);
    }
    expect(inventory.confirmReservations).not.toHaveBeenCalled();
  });

  it('si la confirmación falla, el cobro no se pierde', async () => {
    // El dinero ya entró y eso es lo que no puede deshacerse: el pedido se
    // queda pagado y pendiente, como antes de esta tarjeta.
    inventory.confirmReservations.mockRejectedValue(
      new Error('fila bloqueada'),
    );
    const order = pedido();

    await expect(service.confirmarPorPago(order, 'user-1')).resolves.toBe(
      false,
    );
    expect(order.paymentStatus).toBe(PaymentStatus.PAID);
  });
});
