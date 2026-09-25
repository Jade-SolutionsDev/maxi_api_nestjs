import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import { OrderMailerService } from '../mail/order-mailer.service';
import { OrderEventsService } from '../order-events/order-events.service';
import { OrderEventKind } from '../order-events/entities/order-event.entity';
import {
  CancellationReason,
  Order,
  PaymentStatus,
} from '../orders/entities/order.entity';
import { User } from '../users/entities/user.entity';
import {
  CompleteRefundDto,
  CreateRefundDto,
  RefundResponseDto,
  RejectRefundDto,
} from './dto/refund.dto';
import {
  Refund,
  RefundMethod,
  RefundOrigin,
  RefundStatus,
} from './entities/refund.entity';

/** Quién pide la devolución: una persona del back-office, o el propio sistema. */
export type RefundActor = { userId: string } | { system: true };

export interface RefundSummary {
  /** Total cobrado del pedido. */
  total: string;
  /** Ya devuelto y confirmado. */
  refunded: string;
  /** Comprometido pero todavía sin salir. */
  requested: string;
  /** Lo que aún se puede devolver: total − devuelto − comprometido. */
  refundable: string;
}

/** El dinero se cuenta en centavos enteros; los decimales flotantes mienten. */
const cents = (amount: string | number): number =>
  Math.round(Number(amount) * 100);
const fromCents = (value: number): string => (value / 100).toFixed(2);

/**
 * Devoluciones de dinero.
 *
 * Tres reglas dan forma a todo lo demás:
 *
 * 1. **Solicitar no es devolver.** Una fila `requested` es el compromiso; el
 *    pedido sigue `paid` hasta que alguien confirma que el dinero salió. Es lo
 *    que pidió el cliente y lo que evita dar por devuelto lo que no lo está.
 * 2. **Nunca se devuelve más de lo cobrado.** Lo comprometido cuenta igual que
 *    lo pagado: dos solicitudes abiertas no pueden sumar más que el total.
 * 3. **El pedido pasa a `refunded` solo cuando lo devuelto iguala lo cobrado.**
 *    Una devolución parcial deja el pedido cobrado por el resto.
 */
@Injectable()
export class RefundsService {
  private readonly logger = new Logger(RefundsService.name);

  constructor(
    @InjectRepository(Refund)
    private readonly refundRepository: Repository<Refund>,
    @InjectRepository(Order)
    private readonly orderRepository: Repository<Order>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly dataSource: DataSource,
    private readonly orderEvents: OrderEventsService,
    private readonly mailer: OrderMailerService,
  ) {}

  /** Cuánto se cobró, cuánto se devolvió y cuánto queda por devolver. */
  async summary(orderId: string): Promise<RefundSummary> {
    const order = await this.orderRepository.findOne({
      where: { id: orderId },
    });
    if (!order) {
      throw new NotFoundException(`Order with id "${orderId}" not found`);
    }
    return this.summaryFor(order);
  }

  async listForOrder(orderId: string): Promise<RefundResponseDto[]> {
    const refunds = await this.refundRepository.find({
      where: { orderId },
      order: { requestedAt: 'DESC' },
    });
    return this.decorate(refunds);
  }

  /**
   * La cola: lo que espera a que alguien mueva el dinero, lo más viejo
   * primero. Los pedidos que se pagaron tarde y ya no tenían mercancía salen
   * marcados — ahí hay dinero de un cliente sin nada a cambio.
   */
  async listQueue(status?: RefundStatus): Promise<RefundResponseDto[]> {
    const refunds = await this.refundRepository.find({
      where: { status: status ?? RefundStatus.REQUESTED },
      order: { requestedAt: 'ASC' },
    });
    return this.decorate(refunds);
  }

  async request(
    orderId: string,
    dto: CreateRefundDto,
    actor: RefundActor,
  ): Promise<RefundResponseDto> {
    const order = await this.orderRepository.findOne({
      where: { id: orderId },
    });
    if (!order) {
      throw new NotFoundException(`Order with id "${orderId}" not found`);
    }
    if (order.paymentStatus !== PaymentStatus.PAID) {
      throw new ConflictException(
        `Solo se puede reembolsar un pedido cobrado; este está en "${order.paymentStatus}"`,
      );
    }

    const summary = await this.summaryFor(order);
    const refundable = cents(summary.refundable);
    if (refundable <= 0) {
      throw new ConflictException(
        `Este pedido ya tiene comprometido o devuelto todo lo cobrado (${summary.total} ${'USD'})`,
      );
    }
    const amount = dto.amount ? cents(dto.amount) : refundable;
    if (amount <= 0) {
      throw new BadRequestException(
        'El importe a devolver tiene que ser mayor que cero',
      );
    }
    if (amount > refundable) {
      throw new ConflictException(
        `No se puede devolver ${fromCents(amount)}: de este pedido solo quedan ${summary.refundable} por devolver`,
      );
    }

    const refund = await this.refundRepository.save(
      this.refundRepository.create({
        orderId: order.id,
        amount: fromCents(amount),
        currency: 'USD',
        status: RefundStatus.REQUESTED,
        method: dto.method ?? RefundMethod.MANUAL,
        origin: 'system' in actor ? RefundOrigin.SYSTEM : RefundOrigin.ADMIN,
        reason: dto.reason,
        destination: dto.destination ?? null,
        notes: dto.notes ?? null,
        requestedBy: 'userId' in actor ? actor.userId : null,
        requestedAt: new Date(),
      }),
    );

    await this.orderEvents.record(null, {
      orderId: order.id,
      kind: OrderEventKind.REFUND_REQUESTED,
      actor: 'userId' in actor ? { userId: actor.userId } : { system: true },
      field: 'refund',
      nextValue: `${fromCents(amount)} USD`,
      reason: dto.reason,
      meta: { refundId: refund.id, amount: fromCents(amount) },
    });

    void this.mailer.refundRequested(order.id, {
      amount: refund.amount,
      currency: refund.currency,
      destination: refund.destination,
      providerRef: null,
      partial: amount < cents(order.total),
    });

    return (await this.decorate([refund]))[0];
  }

  /**
   * El dinero salió. Este es el único punto que puede dejar un pedido en
   * `refunded`, y solo cuando lo devuelto iguala lo cobrado.
   */
  async complete(
    user: User,
    refundId: string,
    dto: CompleteRefundDto,
  ): Promise<RefundResponseDto> {
    const refund = await this.refundRepository.findOne({
      where: { id: refundId },
    });
    if (!refund) {
      throw new NotFoundException(`Refund with id "${refundId}" not found`);
    }
    if (refund.status !== RefundStatus.REQUESTED) {
      throw new ConflictException(
        `Este reembolso ya está en "${refund.status}"`,
      );
    }
    const destination = dto.destination ?? refund.destination;
    if (refund.method === RefundMethod.MANUAL && !destination) {
      throw new BadRequestException(
        'Hace falta decir a dónde se envió el dinero (dirección USDT en red BEP20 o referencia)',
      );
    }

    const order = await this.orderRepository.findOne({
      where: { id: refund.orderId },
    });
    if (!order) {
      throw new NotFoundException(
        `Order with id "${refund.orderId}" not found`,
      );
    }

    const now = new Date();
    let fullyRefunded = false;

    await this.dataSource.transaction(async (manager) => {
      const refundRepo = manager.getRepository(Refund);
      refund.status = RefundStatus.COMPLETED;
      refund.destination = destination ?? null;
      refund.providerRef = dto.providerRef ?? refund.providerRef;
      refund.notes = dto.notes ?? refund.notes;
      refund.completedBy = user.id;
      refund.completedAt = now;
      await refundRepo.save(refund);

      const completedTotal = await this.completedCents(refund.orderId, manager);
      fullyRefunded = completedTotal >= cents(order.total);

      await this.orderEvents.record(manager, {
        orderId: order.id,
        kind: OrderEventKind.REFUND_COMPLETED,
        actor: { userId: user.id },
        field: 'refund',
        previousValue: RefundStatus.REQUESTED,
        nextValue: `${refund.amount} USD`,
        reason: refund.reason,
        meta: {
          refundId: refund.id,
          amount: refund.amount,
          destination: refund.destination,
          providerRef: refund.providerRef,
          partial: !fullyRefunded,
        },
      });

      if (fullyRefunded && order.paymentStatus !== PaymentStatus.REFUNDED) {
        const previous = order.paymentStatus;
        order.paymentStatus = PaymentStatus.REFUNDED;
        await manager.getRepository(Order).save(order);
        await this.orderEvents.record(manager, {
          orderId: order.id,
          kind: OrderEventKind.PAYMENT_STATUS_CHANGED,
          actor: { userId: user.id },
          field: 'paymentStatus',
          previousValue: previous,
          nextValue: PaymentStatus.REFUNDED,
          reason: 'Se devolvió todo lo cobrado',
          meta: { refundId: refund.id },
        });
      }
    });

    void this.mailer.refundCompleted(order.id, {
      amount: refund.amount,
      currency: refund.currency,
      destination: refund.destination,
      providerRef: refund.providerRef,
      partial: !fullyRefunded,
    });

    return (await this.decorate([refund]))[0];
  }

  async reject(
    user: User,
    refundId: string,
    dto: RejectRefundDto,
  ): Promise<RefundResponseDto> {
    const refund = await this.refundRepository.findOne({
      where: { id: refundId },
    });
    if (!refund) {
      throw new NotFoundException(`Refund with id "${refundId}" not found`);
    }
    if (refund.status !== RefundStatus.REQUESTED) {
      throw new ConflictException(
        `Este reembolso ya está en "${refund.status}"`,
      );
    }
    refund.status = RefundStatus.REJECTED;
    refund.rejectedBy = user.id;
    refund.rejectedAt = new Date();
    refund.rejectionReason = dto.reason;
    await this.refundRepository.save(refund);

    await this.orderEvents.record(null, {
      orderId: refund.orderId,
      kind: OrderEventKind.REFUND_REJECTED,
      actor: { userId: user.id },
      field: 'refund',
      previousValue: RefundStatus.REQUESTED,
      nextValue: RefundStatus.REJECTED,
      reason: dto.reason,
      meta: { refundId: refund.id, amount: refund.amount },
    });

    return (await this.decorate([refund]))[0];
  }

  /**
   * Devolución que abre el propio sistema: el cliente pagó después de que su
   * pedido caducara y la mercancía ya no estaba. Es el único caso donde el
   * dinero entró sin contrapartida posible, así que la cola no espera a que
   * alguien se acuerde.
   */
  async requestForLatePaymentWithoutStock(order: Order): Promise<void> {
    try {
      await this.request(
        order.id,
        {
          reason:
            'El pago llegó después de que el pedido caducara y ya no había mercancía disponible',
        },
        { system: true },
      );
      this.logger.warn(
        `Pedido ${order.orderNumber ?? order.id}: reembolso abierto automáticamente, pago tardío sin stock`,
      );
    } catch (err) {
      // Que no haya cola no puede impedir que el webhook termine.
      this.logger.error(
        `No se pudo abrir el reembolso automático del pedido ${order.orderNumber ?? order.id}`,
        err instanceof Error ? err.stack : String(err),
      );
    }
  }

  private async summaryFor(order: Order): Promise<RefundSummary> {
    const rows = await this.refundRepository.find({
      where: {
        orderId: order.id,
        status: In([RefundStatus.REQUESTED, RefundStatus.COMPLETED]),
      },
    });
    const completed = rows
      .filter((row) => row.status === RefundStatus.COMPLETED)
      .reduce((sum, row) => sum + cents(row.amount), 0);
    const requested = rows
      .filter((row) => row.status === RefundStatus.REQUESTED)
      .reduce((sum, row) => sum + cents(row.amount), 0);
    const total = cents(order.total);
    return {
      total: fromCents(total),
      refunded: fromCents(completed),
      requested: fromCents(requested),
      refundable: fromCents(Math.max(0, total - completed - requested)),
    };
  }

  private async completedCents(
    orderId: string,
    manager: EntityManager,
  ): Promise<number> {
    const rows = await manager.getRepository(Refund).find({
      where: { orderId, status: RefundStatus.COMPLETED },
    });
    return rows.reduce((sum, row) => sum + cents(row.amount), 0);
  }

  /** Añade a cada fila lo que la administración necesita ver: pedido, cliente, quién actuó. */
  private async decorate(refunds: Refund[]): Promise<RefundResponseDto[]> {
    if (!refunds.length) {
      return [];
    }
    const orders = await this.orderRepository.find({
      where: { id: In([...new Set(refunds.map((r) => r.orderId))]) },
      relations: { client: true },
      withDeleted: true,
    });
    const orderById = new Map(orders.map((order) => [order.id, order]));

    const userIds = [
      ...new Set(
        refunds
          .flatMap((r) => [r.requestedBy, r.completedBy])
          .filter((id): id is string => Boolean(id)),
      ),
    ];
    const users = userIds.length
      ? await this.userRepository.find({ where: { id: In(userIds) } })
      : [];
    const nameById = new Map(
      users.map((user) => [
        user.id,
        [user.firstName, user.lastName].filter(Boolean).join(' ') ||
          user.email ||
          user.id,
      ]),
    );

    return refunds.map((refund) => {
      const dto = RefundResponseDto.fromEntity(refund);
      const order = orderById.get(refund.orderId);
      if (order) {
        dto.orderNumber = order.orderNumber;
        dto.orderTotal = order.total;
        dto.paidAfterExpiryOutOfStock =
          order.cancellationReason ===
          CancellationReason.PAID_AFTER_EXPIRY_OUT_OF_STOCK;
        const client = order.client;
        dto.clientName = client
          ? [client.firstName, client.lastName].filter(Boolean).join(' ') ||
            null
          : null;
        dto.clientEmail = client?.email ?? null;
      }
      dto.requestedByName = refund.requestedBy
        ? (nameById.get(refund.requestedBy) ?? null)
        : null;
      dto.completedByName = refund.completedBy
        ? (nameById.get(refund.completedBy) ?? null)
        : null;
      return dto;
    });
  }
}
