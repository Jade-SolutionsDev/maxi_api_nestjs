import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, IsNull, Repository } from 'typeorm';
import { CartService } from '../cart/cart.service';
import { CartItem } from '../cart/entities/cart-item.entity';
import { Client } from '../clients/entities/client.entity';
import {
  buildPaginatedResponse,
  getPaginationParams,
  PaginatedResponse,
} from '../common/dto/pagination.dto';
import { InventoryService } from '../inventory/inventory.service';
import { Role, User } from '../users/entities/user.entity';
import { AdminOrdersQueryDto } from './dto/admin-orders-query.dto';
import { CheckoutDto } from './dto/checkout.dto';
import { OrderResponseDto } from './dto/order-response.dto';
import { OrderItem } from './entities/order-item.entity';
import { Order, OrderStatus, PaymentStatus } from './entities/order.entity';
import { PaymentMethodsService } from '../payments/payment-methods.service';
import { PaymentsService } from '../payments/payments.service';

const TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  [OrderStatus.PENDING]: [OrderStatus.CONFIRMED, OrderStatus.CANCELLED],
  [OrderStatus.CONFIRMED]: [OrderStatus.PROCESSING, OrderStatus.CANCELLED],
  [OrderStatus.PROCESSING]: [OrderStatus.SHIPPED, OrderStatus.CANCELLED],
  [OrderStatus.SHIPPED]: [OrderStatus.DELIVERED, OrderStatus.CANCELLED],
  [OrderStatus.DELIVERED]: [],
  [OrderStatus.CANCELLED]: [],
};

// Legal manual payment-status moves: settle or fail a pending payment, retry
// a failed one, refund a paid one. Webhooks bypass this (gateway is truth).
const PAYMENT_TRANSITIONS: Record<PaymentStatus, PaymentStatus[]> = {
  [PaymentStatus.PENDING]: [PaymentStatus.PAID, PaymentStatus.FAILED],
  [PaymentStatus.FAILED]: [PaymentStatus.PAID, PaymentStatus.PENDING],
  [PaymentStatus.PAID]: [PaymentStatus.REFUNDED],
  [PaymentStatus.REFUNDED]: [],
};

// Fulfillment steps a GROCER may drive; confirm/cancel (which move stock and
// commit the sale) and payment stay with ADMIN+.
const GROCER_TARGETS = [
  OrderStatus.PROCESSING,
  OrderStatus.SHIPPED,
  OrderStatus.DELIVERED,
];

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    @InjectRepository(Order)
    private readonly orderRepository: Repository<Order>,
    private readonly cartService: CartService,
    private readonly inventoryService: InventoryService,
    private readonly paymentsService: PaymentsService,
    private readonly paymentMethodsService: PaymentMethodsService,
    private readonly dataSource: DataSource,
  ) {}

  // ---------------- Storefront ----------------

  // Turns the client's cart into a pending order: snapshots names/prices from
  // the cart response (already server-computed), reserves stock per line, and
  // clears the cart — all in one transaction. Payment initiation runs AFTER
  // commit: an outbound gateway call must not hold the inventory row locks,
  // and a gateway failure must not lose the order.
  async checkout(client: Client, dto: CheckoutDto): Promise<OrderResponseDto> {
    // Same municipality the order ships to, so availability is judged against
    // the zone the customer is actually buying for.
    const deliveryMunicipalityId =
      dto.deliveryMunicipalityId ?? client.defaultMunicipalityId ?? undefined;
    const cart = await this.cartService.getCart(client.id, {
      municipalityId: deliveryMunicipalityId,
    });
    if (cart.items.length === 0) {
      throw new BadRequestException('Cart is empty');
    }
    const unavailable = cart.items.filter((i) => !i.isAvailable);
    if (unavailable.length > 0) {
      throw new ConflictException({
        message: 'Some cart items are no longer available',
        details: unavailable.map((i) => ({
          field: i.productId,
          message: `"${i.name}": only ${i.available} available`,
          available: i.available,
        })),
      });
    }

    const orderId = await this.dataSource.transaction(async (manager) => {
      const orderRepo = manager.getRepository(Order);
      const order = await orderRepo.save(
        orderRepo.create({
          clientId: client.id,
          status: OrderStatus.PENDING,
          paymentStatus: PaymentStatus.PENDING,
          subtotal: cart.subtotal.toFixed(2),
          deliveryFee: '0.00',
          total: cart.subtotal.toFixed(2),
          deliveryMunicipalityId: deliveryMunicipalityId ?? null,
          deliveryAddress: dto.deliveryAddress ?? null,
          customerNotes: dto.customerNotes ?? null,
        }),
      );
      order.orderNumber = `ORD-${new Date().getFullYear()}${String(order.seq).padStart(4, '0')}`;
      await orderRepo.save(order);

      const itemRepo = manager.getRepository(OrderItem);
      for (const line of cart.items) {
        // reserve() re-checks availability under lock — a concurrent checkout
        // of the same stock loses with the same 409 shape as the cart.
        await this.inventoryService.reserve(
          manager,
          order.id,
          line.productId,
          line.quantity,
        );
        await itemRepo.save(
          itemRepo.create({
            orderId: order.id,
            productId: line.productId,
            productNameSnapshot: line.name,
            unitPrice: line.unitPrice.toFixed(2),
            quantity: line.quantity,
            lineTotal: line.lineTotal.toFixed(2),
          }),
        );
      }

      await manager.getRepository(CartItem).delete({ clientId: client.id });
      return order.id;
    });

    // Post-commit payment initiation: an outbound gateway call must not hold
    // the inventory row locks, and a gateway failure must not lose the order —
    // it survives unpaid and the customer retries via
    // POST /storefront/orders/:id/payment.
    try {
      const order = (await this.orderRepository.findOne({
        where: { id: orderId },
      })) as Order;
      const gateway = await this.paymentMethodsService.resolve(
        dto.paymentMethod,
      );
      await this.paymentsService.createChargeForOrder(order, gateway);
    } catch (err) {
      this.logger.error(
        `Payment initiation failed for order ${orderId}`,
        err instanceof Error ? err.stack : String(err),
      );
    }

    return this.findOneForClient(client.id, orderId);
  }

  async findForClient(
    clientId: string,
    page?: number,
    limit?: number,
  ): Promise<PaginatedResponse<OrderResponseDto>> {
    const params = getPaginationParams({ page, limit });
    const [orders, total] = await this.orderRepository.findAndCount({
      // withDeleted below is for the product join; the orders themselves must
      // still respect their own soft delete.
      where: { clientId, deletedAt: IsNull() },
      relations: { items: { product: true } },
      withDeleted: true, // soft-deleted products must still render on old orders
      order: { createdAt: 'DESC' },
      skip: params.skip,
      take: params.limit,
    });
    return buildPaginatedResponse(
      orders.map((o) => OrderResponseDto.fromEntity(o)),
      total,
      params.page,
      params.limit,
    );
  }

  async findOneForClient(
    clientId: string,
    id: string,
  ): Promise<OrderResponseDto> {
    const order = await this.orderRepository.findOne({
      where: { id, clientId },
      relations: { items: { product: true } },
      withDeleted: true,
    });
    if (!order || order.deletedAt) {
      throw new NotFoundException(`Order with id "${id}" not found`);
    }
    const dto = OrderResponseDto.fromEntity(order);
    dto.payment = await this.paymentsService.latestChargeDto(order.id);
    return dto;
  }

  // Customers may back out only while the order is pending (not yet accepted).
  async cancelByClient(
    clientId: string,
    id: string,
  ): Promise<OrderResponseDto> {
    const order = await this.orderRepository.findOne({
      where: { id, clientId },
    });
    if (!order) {
      throw new NotFoundException(`Order with id "${id}" not found`);
    }
    if (order.status !== OrderStatus.PENDING) {
      throw new ConflictException(
        `Only pending orders can be cancelled (current status: ${order.status})`,
      );
    }
    await this.dataSource.transaction(async (manager) => {
      await this.inventoryService.releaseReservations(manager, order.id);
      order.status = OrderStatus.CANCELLED;
      await manager.getRepository(Order).save(order);
    });
    return this.findOneForClient(clientId, id);
  }

  // ---------------- Admin ----------------

  async findAllAdmin(
    query: AdminOrdersQueryDto,
  ): Promise<PaginatedResponse<OrderResponseDto>> {
    const { page, limit, skip } = getPaginationParams(query);
    const qb = this.orderRepository
      .createQueryBuilder('order')
      .leftJoinAndSelect('order.client', 'client');

    if (query.id) {
      qb.andWhere('order.id IN (:...ids)', { ids: query.id.split(',') });
    }
    if (query.clientId) {
      qb.andWhere('order.clientId = :clientId', { clientId: query.clientId });
    }
    if (query.q) {
      qb.andWhere(
        `(order.orderNumber ILIKE :q OR client.email ILIKE :q
          OR client.firstName ILIKE :q OR client.lastName ILIKE :q)`,
        { q: `%${query.q}%` },
      );
    }
    if (query.status) {
      qb.andWhere('order.status = :status', { status: query.status });
    }
    if (query.paymentStatus) {
      qb.andWhere('order.paymentStatus = :paymentStatus', {
        paymentStatus: query.paymentStatus,
      });
    }

    const sortColumns: Record<string, string> = {
      orderNumber: 'order.orderNumber',
      status: 'order.status',
      paymentStatus: 'order.paymentStatus',
      total: 'order.total',
      createdAt: 'order.createdAt',
    };
    const sortColumn = sortColumns[query.sortBy ?? ''] ?? 'order.createdAt';
    const dir = (query.sortOrder ?? 'desc').toUpperCase() as 'ASC' | 'DESC';
    // id as deterministic tiebreaker (same rationale as the users list).
    qb.orderBy(sortColumn, dir)
      .addOrderBy('order.id', 'DESC')
      .skip(skip)
      .take(limit);

    const [orders, total] = await qb.getManyAndCount();
    return buildPaginatedResponse(
      orders.map((o) => OrderResponseDto.fromEntity(o)),
      total,
      page,
      limit,
    );
  }

  async findOneAdmin(id: string): Promise<OrderResponseDto> {
    const order = await this.orderRepository.findOne({
      where: { id },
      relations: { client: true, items: { product: true } },
      withDeleted: true,
    });
    if (!order || order.deletedAt) {
      throw new NotFoundException(`Order with id "${id}" not found`);
    }
    const dto = OrderResponseDto.fromEntity(order);
    dto.payment = await this.paymentsService.latestChargeDto(order.id);
    return dto;
  }

  async updateStatus(
    user: User,
    id: string,
    status: OrderStatus,
  ): Promise<OrderResponseDto> {
    const order = await this.orderRepository.findOne({ where: { id } });
    if (!order) {
      throw new NotFoundException(`Order with id "${id}" not found`);
    }
    if (!TRANSITIONS[order.status].includes(status)) {
      throw new ConflictException(
        `Cannot move order from "${order.status}" to "${status}"`,
      );
    }
    if (user.role === Role.GROCER && !GROCER_TARGETS.includes(status)) {
      throw new ForbiddenException(
        'Grocers can only advance fulfillment (processing, shipped, delivered)',
      );
    }

    await this.dataSource.transaction(async (manager) => {
      if (status === OrderStatus.CONFIRMED) {
        // The hold becomes a physical stock decrement.
        await this.inventoryService.confirmReservations(manager, order.id);
      } else if (status === OrderStatus.CANCELLED) {
        // Releases holds; restocks allocations already confirmed.
        await this.inventoryService.releaseReservations(manager, order.id);
      }
      order.status = status;
      await manager.getRepository(Order).save(order);
    });
    return this.findOneAdmin(id);
  }

  // Manual override (refunds, gateway-outage corrections). Guarded so an
  // admin can't produce nonsense like paid -> pending.
  async updatePaymentStatus(
    id: string,
    paymentStatus: PaymentStatus,
  ): Promise<OrderResponseDto> {
    const order = await this.orderRepository.findOne({ where: { id } });
    if (!order) {
      throw new NotFoundException(`Order with id "${id}" not found`);
    }
    if (!PAYMENT_TRANSITIONS[order.paymentStatus].includes(paymentStatus)) {
      throw new ConflictException(
        `Cannot move payment from "${order.paymentStatus}" to "${paymentStatus}"`,
      );
    }
    order.paymentStatus = paymentStatus;
    await this.orderRepository.save(order);
    return this.findOneAdmin(id);
  }
}
