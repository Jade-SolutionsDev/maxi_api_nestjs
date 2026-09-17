import { BadRequestException, ConflictException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { OrderMailerService } from '../mail/order-mailer.service';
import { OrderEventsService } from '../order-events/order-events.service';
import { OrderEventKind } from '../order-events/entities/order-event.entity';
import {
  CancellationReason,
  Order,
  PaymentStatus,
} from '../orders/entities/order.entity';
import { User } from '../users/entities/user.entity';
import { Refund, RefundStatus } from './entities/refund.entity';
import { RefundsService } from './refunds.service';

const user = { id: 'u1' } as User;

describe('RefundsService', () => {
  let service: RefundsService;
  let refunds: Refund[];
  let order: Order;
  let refundRepo: {
    find: jest.Mock;
    findOne: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
  };
  let orderRepo: { findOne: jest.Mock; find: jest.Mock; save: jest.Mock };
  let events: { record: jest.Mock };
  let mailer: { refundRequested: jest.Mock; refundCompleted: jest.Mock };

  const makeRefund = (partial: Partial<Refund>): Refund =>
    ({
      id: `r${refunds.length + 1}`,
      orderId: 'o1',
      amount: '10.00',
      currency: 'USD',
      status: RefundStatus.REQUESTED,
      method: 'manual',
      origin: 'admin',
      reason: 'motivo de prueba',
      destination: null,
      providerRef: null,
      notes: null,
      requestedBy: 'u1',
      requestedAt: new Date(),
      completedBy: null,
      completedAt: null,
      rejectedBy: null,
      rejectedAt: null,
      rejectionReason: null,
      ...partial,
    }) as Refund;

  beforeEach(async () => {
    refunds = [];
    order = {
      id: 'o1',
      orderNumber: 'ORD-20260001',
      total: '60.00',
      paymentStatus: PaymentStatus.PAID,
      cancellationReason: null,
    } as Order;

    refundRepo = {
      find: jest.fn().mockImplementation((options: { where?: any }) => {
        const where = options?.where ?? {};
        return Promise.resolve(
          refunds.filter((row) => {
            if (where.orderId && row.orderId !== where.orderId) return false;
            if (!where.status) return true;
            const wanted: unknown = where.status;
            // In(...) llega como objeto con `_value`; un estado suelto, como string.
            const values =
              typeof wanted === 'string'
                ? [wanted]
                : ((wanted as { _value?: string[] })._value ?? []);
            return values.includes(row.status);
          }),
        );
      }),
      findOne: jest
        .fn()
        .mockImplementation((options: { where: { id: string } }) =>
          Promise.resolve(
            refunds.find((row) => row.id === options.where.id) ?? null,
          ),
        ),
      create: jest
        .fn()
        .mockImplementation((data: Partial<Refund>) => makeRefund(data)),
      save: jest.fn().mockImplementation((row: Refund) => {
        if (!refunds.includes(row)) refunds.push(row);
        return Promise.resolve(row);
      }),
    };
    orderRepo = {
      findOne: jest.fn().mockResolvedValue(order),
      find: jest.fn().mockResolvedValue([order]),
      save: jest.fn().mockImplementation((o: Order) => Promise.resolve(o)),
    };
    events = { record: jest.fn().mockResolvedValue(undefined) };
    mailer = {
      refundRequested: jest.fn().mockResolvedValue(null),
      refundCompleted: jest.fn().mockResolvedValue(null),
    };

    const manager = {
      getRepository: (entity: unknown) =>
        entity === Refund ? refundRepo : orderRepo,
    };
    const dataSource = {
      transaction: jest
        .fn()
        .mockImplementation((cb: (m: unknown) => Promise<unknown>) =>
          cb(manager),
        ),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RefundsService,
        { provide: getRepositoryToken(Refund), useValue: refundRepo },
        { provide: getRepositoryToken(Order), useValue: orderRepo },
        {
          provide: getRepositoryToken(User),
          useValue: { find: jest.fn().mockResolvedValue([]) },
        },
        { provide: DataSource, useValue: dataSource },
        { provide: OrderEventsService, useValue: events },
        { provide: OrderMailerService, useValue: mailer },
      ],
    }).compile();
    service = module.get(RefundsService);
  });

  describe('solicitar', () => {
    it('rechaza un pedido que no está cobrado', async () => {
      order.paymentStatus = PaymentStatus.PENDING;
      await expect(
        service.request('o1', { reason: 'se arrepintió' }, { userId: 'u1' }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('sin importe compromete todo lo que queda por devolver', async () => {
      const dto = await service.request(
        'o1',
        { reason: 'no había mercancía' },
        { userId: 'u1' },
      );
      expect(dto.amount).toBe('60.00');
      expect(dto.status).toBe(RefundStatus.REQUESTED);
      expect(events.record).toHaveBeenCalledWith(
        null,
        expect.objectContaining({ kind: OrderEventKind.REFUND_REQUESTED }),
      );
    });

    it('no deja comprometer más de lo cobrado entre varias solicitudes', async () => {
      await service.request(
        'o1',
        { amount: '40.00', reason: 'primera parte' },
        { userId: 'u1' },
      );
      await expect(
        service.request(
          'o1',
          { amount: '30.00', reason: 'segunda parte' },
          { userId: 'u1' },
        ),
      ).rejects.toBeInstanceOf(ConflictException);
      // Lo que sí cabe, entra.
      const rest = await service.request(
        'o1',
        { amount: '20.00', reason: 'el resto' },
        { userId: 'u1' },
      );
      expect(rest.amount).toBe('20.00');
    });

    it('el pedido sigue cobrado mientras nadie confirme que el dinero salió', async () => {
      await service.request(
        'o1',
        { reason: 'pendiente de enviar' },
        { userId: 'u1' },
      );
      expect(order.paymentStatus).toBe(PaymentStatus.PAID);
      expect(orderRepo.save).not.toHaveBeenCalled();
    });
  });

  describe('confirmar', () => {
    it('exige decir a dónde se envió en los reembolsos manuales', async () => {
      const created = await service.request(
        'o1',
        { reason: 'devolución' },
        { userId: 'u1' },
      );
      await expect(
        service.complete(user, created.id, {}),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('una devolución parcial deja el pedido cobrado', async () => {
      const created = await service.request(
        'o1',
        { amount: '20.00', reason: 'faltó un producto' },
        { userId: 'u1' },
      );
      const done = await service.complete(user, created.id, {
        destination: '0xabc',
      });
      expect(done.status).toBe(RefundStatus.COMPLETED);
      expect(order.paymentStatus).toBe(PaymentStatus.PAID);
      expect(mailer.refundCompleted).toHaveBeenCalledWith(
        'o1',
        expect.objectContaining({ partial: true }),
      );
    });

    it('devolver todo lo cobrado pasa el pedido a reembolsado', async () => {
      const created = await service.request(
        'o1',
        { reason: 'devolución completa' },
        { userId: 'u1' },
      );
      await service.complete(user, created.id, { destination: '0xabc' });
      expect(order.paymentStatus).toBe(PaymentStatus.REFUNDED);
      expect(events.record).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          kind: OrderEventKind.PAYMENT_STATUS_CHANGED,
          nextValue: PaymentStatus.REFUNDED,
        }),
      );
    });

    it('dos parciales que suman el total también lo pasan a reembolsado', async () => {
      const first = await service.request(
        'o1',
        { amount: '25.00', reason: 'parte una' },
        { userId: 'u1' },
      );
      await service.complete(user, first.id, { destination: '0xabc' });
      expect(order.paymentStatus).toBe(PaymentStatus.PAID);
      const second = await service.request(
        'o1',
        { amount: '35.00', reason: 'parte dos' },
        { userId: 'u1' },
      );
      await service.complete(user, second.id, { destination: '0xabc' });
      expect(order.paymentStatus).toBe(PaymentStatus.REFUNDED);
    });

    it('no se confirma dos veces', async () => {
      const created = await service.request(
        'o1',
        { reason: 'devolución' },
        { userId: 'u1' },
      );
      await service.complete(user, created.id, { destination: '0xabc' });
      await expect(
        service.complete(user, created.id, { destination: '0xabc' }),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('rechazar', () => {
    it('deja constancia del motivo y no toca el pedido', async () => {
      const created = await service.request(
        'o1',
        { reason: 'lo pidió el cliente' },
        { userId: 'u1' },
      );
      const rejected = await service.reject(user, created.id, {
        reason: 'fuera de las 48 horas',
      });
      expect(rejected.status).toBe(RefundStatus.REJECTED);
      expect(rejected.rejectionReason).toBe('fuera de las 48 horas');
      expect(order.paymentStatus).toBe(PaymentStatus.PAID);
    });
  });

  describe('pago tardío sin mercancía', () => {
    it('abre la devolución solo, marcada como del sistema', async () => {
      order.cancellationReason =
        CancellationReason.PAID_AFTER_EXPIRY_OUT_OF_STOCK;
      await service.requestForLatePaymentWithoutStock(order);
      const queue = await service.listQueue();
      expect(queue).toHaveLength(1);
      expect(queue[0].origin).toBe('system');
      expect(queue[0].amount).toBe('60.00');
      expect(queue[0].paidAfterExpiryOutOfStock).toBe(true);
    });

    it('un fallo al abrirla no tumba el webhook', async () => {
      order.paymentStatus = PaymentStatus.PENDING;
      await expect(
        service.requestForLatePaymentWithoutStock(order),
      ).resolves.toBeUndefined();
    });
  });
});
