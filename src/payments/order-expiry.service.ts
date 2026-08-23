import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, IsNull, LessThan, Repository } from 'typeorm';
import { ExpiryConfig, PaymentsConfig } from '../config/configuration';
import { InventoryService } from '../inventory/inventory.service';
import {
  CancellationReason,
  Order,
  OrderStatus,
  PaymentStatus,
} from '../orders/entities/order.entity';
import { ChargeStatus, PaymentCharge } from './entities/payment-charge.entity';
import { PaymentMethodsService } from './payment-methods.service';
import { PaymentsService } from './payments.service';

export interface ExpirySweepResult {
  /** Orders old enough to be worth examining. */
  scanned: number;
  /** Orders whose deadline had passed and that were cancelled. */
  cancelled: number;
  /** Order ids cancelled, so the schedule log names what it touched. */
  orderIds: string[];
}

/**
 * An order pending payment holds stock, and the catalogue shows
 * `available = quantity - reserved_quantity` — so an order nobody pays takes
 * goods out of the shop window. Past a deadline it is cancelled and the hold
 * released.
 *
 * Two deadlines, because the two ways of paying wait on different things: with
 * a gateway the customer is at the payment page right now (minutes), while a
 * manual payment waits on an admin marking it (a day).
 */
@Injectable()
export class OrderExpiryService {
  private readonly logger = new Logger(OrderExpiryService.name);

  constructor(
    @InjectRepository(Order)
    private readonly orderRepository: Repository<Order>,
    private readonly paymentsService: PaymentsService,
    private readonly methodsService: PaymentMethodsService,
    private readonly inventoryService: InventoryService,
    private readonly configService: ConfigService,
    private readonly dataSource: DataSource,
  ) {}

  private get config(): ExpiryConfig {
    return this.configService.get<PaymentsConfig>('payments')!.expiry;
  }

  async sweep(): Promise<ExpirySweepResult> {
    const { gatewayMinutes, manualHours } = this.config;
    const now = Date.now();
    // Nothing younger than the shortest window can possibly be due, so the
    // database never hands us the whole pending backlog.
    const newestWorthChecking = new Date(now - gatewayMinutes * 60_000);

    const candidates = await this.orderRepository.find({
      where: {
        status: OrderStatus.PENDING,
        paymentStatus: In([PaymentStatus.PENDING, PaymentStatus.FAILED]),
        deletedAt: IsNull(),
        createdAt: LessThan(newestWorthChecking),
      },
    });
    if (candidates.length === 0) {
      return { scanned: 0, cancelled: 0, orderIds: [] };
    }

    const charges = await this.paymentsService.latestChargesFor(
      candidates.map((order) => order.id),
    );

    const due = candidates.filter((order) =>
      this.isExpired(order, charges.get(order.id), now),
    );

    // Count what actually happened, not what was due: an order paid between the
    // scan and the transaction is skipped, and a failure on one is logged.
    const orderIds: string[] = [];
    for (const order of due) {
      if (await this.expire(order)) orderIds.push(order.id);
    }

    if (orderIds.length > 0) {
      this.logger.log(
        `Expired ${orderIds.length} unpaid order(s) of ${candidates.length} examined`,
      );
    }
    return {
      scanned: candidates.length,
      cancelled: orderIds.length,
      orderIds,
    };
  }

  private isExpired(
    order: Order,
    charge: PaymentCharge | undefined,
    now: number,
  ): boolean {
    // Money already in flight at the gateway: cancelling underneath it is
    // exactly the race that leaves us paid with the stock sold to someone else.
    if (charge?.status === ChargeStatus.PROCESSING) return false;

    const gateway = charge && this.gatewayKindOf(charge.provider);
    const window =
      gateway && gateway !== 'manual'
        ? this.config.gatewayMinutes * 60_000
        : this.config.manualHours * 3_600_000;

    // Counted from the last payment attempt, so retrying earns a fresh window.
    // With no attempt at all (initiation failed) the order's own age is all we
    // have, and it gets the longer manual window.
    const startedAt = charge?.createdAt ?? order.createdAt;
    return now - startedAt.getTime() >= window;
  }

  private gatewayKindOf(provider: string): string | undefined {
    try {
      return this.methodsService.gatewayFor(provider).kind;
    } catch {
      // A charge from a gateway that no longer exists in this build: treat it
      // as manual rather than expiring it on the short window.
      return undefined;
    }
  }

  // One transaction per order: a failure on one must not strand the rest, and
  // the status is re-checked under the transaction because the customer may
  // have paid between the scan and now.
  private async expire(order: Order): Promise<boolean> {
    try {
      return await this.dataSource.transaction(async (manager) => {
        const repo = manager.getRepository(Order);
        const fresh = await repo.findOne({ where: { id: order.id } });
        if (
          !fresh ||
          fresh.status !== OrderStatus.PENDING ||
          fresh.paymentStatus === PaymentStatus.PAID
        ) {
          return false;
        }
        await this.inventoryService.releaseReservations(manager, fresh.id);
        fresh.status = OrderStatus.CANCELLED;
        fresh.cancellationReason = CancellationReason.PAYMENT_NOT_RECEIVED;
        await repo.save(fresh);
        return true;
      });
    } catch (err) {
      this.logger.error(
        `Could not expire order ${order.orderNumber ?? order.id}`,
        err instanceof Error ? err.stack : String(err),
      );
      return false;
    }
  }
}
