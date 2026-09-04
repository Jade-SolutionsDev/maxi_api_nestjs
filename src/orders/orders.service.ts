import { sinTildes } from '../common/search/accent-insensitive';
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
import { ProductsService } from '../products/products.service';
import { Role, User } from '../users/entities/user.entity';
import {
  AdminOrdersQueryDto,
  SIN_METODO_DE_PAGO,
} from './dto/admin-orders-query.dto';
import { CheckoutDto } from './dto/checkout.dto';
import { OrderResponseDto } from './dto/order-response.dto';
import { OrderItem } from './entities/order-item.entity';
import {
  FulfillmentType,
  Order,
  OrderStatus,
  PaymentStatus,
} from './entities/order.entity';
import { ClientAddressesService } from '../client-addresses/client-addresses.service';
import { ClientAddress } from '../client-addresses/entities/client-address.entity';
import { FulfillmentService } from '../fulfillment/fulfillment.service';
import { GeographyService } from '../geography/geography.service';
import { PaymentGateway } from '../payments/payment-gateway.interface';
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

/** What the order keeps of an address, independent of the address book. */
const snapshotAddress = (
  address: ClientAddress,
  place: { municipality: string; province: string } | null,
): Record<string, unknown> => ({
  label: address.label ?? null,
  street: address.street,
  betweenStreets: address.betweenStreets ?? null,
  reference: address.reference ?? null,
  municipalityId: address.municipalityId,
  // Names too: an id tells a customer reading their own order nothing, and the
  // catalog entry may be renamed or removed long after the order shipped.
  municipalityName: place?.municipality ?? null,
  provinceName: place?.province ?? null,
  contactPhone: address.contactPhone ?? null,
});

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
    private readonly fulfillmentService: FulfillmentService,
    private readonly productsService: ProductsService,
    private readonly clientAddressesService: ClientAddressesService,
    private readonly geographyService: GeographyService,
    private readonly dataSource: DataSource,
  ) {}

  // List rows carry the method name and the transfer flag (not the whole
  // attempt/detail): two batched queries for the page, never one per row.
  private async withPaymentMethods(
    orders: Order[],
  ): Promise<OrderResponseDto[]> {
    const orderIds = orders.map((order) => order.id);
    const [methods, transferIds] = await Promise.all([
      this.paymentsService.latestMethodsFor(orderIds),
      this.needsTransferIds(orderIds),
    ]);
    return orders.map((order) => {
      const dto = OrderResponseDto.fromEntity(order);
      dto.paymentMethod = methods.get(order.id);
      dto.needsTransfer = transferIds.has(order.id);
      return dto;
    });
  }

  // Same predicate as the list's needsTransfer filter: pickup orders still
  // holding RESERVED stock away from their counter.
  private async needsTransferIds(orderIds: string[]): Promise<Set<string>> {
    if (orderIds.length === 0) return new Set();
    const rows: { order_id: string }[] =
      await this.orderRepository.manager.query(
        `SELECT DISTINCT r.order_id
           FROM inventory_reservations r
           JOIN orders o ON o.id = r.order_id
          WHERE r.order_id = ANY($1)
            AND o.fulfillment_type = 'pickup'
            AND r.status = 'reserved'
            AND r.location_id <> o.pickup_location_id`,
        [orderIds],
      );
    return new Set(rows.map((row) => row.order_id));
  }

  // ---------------- Storefront ----------------

  // Turns the client's cart into a pending order: snapshots names/prices from
  // the cart response (already server-computed), reserves stock per line, and
  // clears the cart — all in one transaction. Payment initiation runs AFTER
  // commit: an outbound gateway call must not hold the inventory row locks,
  // and a gateway failure must not lose the order.
  async checkout(client: Client, dto: CheckoutDto): Promise<OrderResponseDto> {
    // Where the order is going, and how. Both are settled before anything is
    // written: a choice the shop cannot honour must 400, not become an order
    // nobody can fill.
    const address = await this.resolveAddress(client, dto);
    const deliveryMunicipalityId =
      address?.municipalityId ??
      dto.deliveryMunicipalityId ??
      client.defaultMunicipalityId ??
      undefined;

    const place = address ? await this.resolvePlace(address) : null;

    const fulfillment = await this.fulfillmentService.resolveChoice({
      fulfillmentType: dto.fulfillmentType,
      deliveryOptionId: dto.deliveryOptionId,
      pickupAddressId: dto.pickupAddressId,
      municipalityId: deliveryMunicipalityId,
    });

    // Availability is judged across every storage covering the customer's
    // municipality — the same stock the catalog showed. A pickup order may
    // draw from sibling storages (the admin gets a transfer alert); pinning it
    // to the counter's own shelf would reject carts the shop can fulfil.
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

    // Resolved before anything is written: an unknown or disabled method must
    // 400 rather than silently produce an order nobody can pay. DB-only, no
    // gateway call.
    const gateway = await this.paymentMethodsService.resolve(dto.paymentMethod);

    const total = (cart.subtotal + Number(fulfillment.fee)).toFixed(2);

    // Reservations stay within the storages covering the municipality; without
    // a municipality (pickup-only client with no location) any active storage
    // may hold the stock, as before.
    const coveringIds = deliveryMunicipalityId
      ? await this.productsService.coveringLocationIds({
          municipalityId: deliveryMunicipalityId,
        })
      : undefined;
    const allowedLocationIds =
      coveringIds && fulfillment.pickupLocationId
        ? [...new Set([...coveringIds, fulfillment.pickupLocationId])]
        : coveringIds;

    const orderId = await this.dataSource.transaction(async (manager) => {
      const orderRepo = manager.getRepository(Order);
      const order = await orderRepo.save(
        orderRepo.create({
          clientId: client.id,
          status: OrderStatus.PENDING,
          paymentStatus: PaymentStatus.PENDING,
          subtotal: cart.subtotal.toFixed(2),
          deliveryFee: fulfillment.fee,
          total,
          fulfillmentType: fulfillment.type,
          deliveryOptionId: fulfillment.deliveryOptionId,
          deliveryOptionLabel: fulfillment.deliveryOptionLabel,
          pickupLocationId: fulfillment.pickupLocationId,
          pickupAddressId: fulfillment.pickupAddressId,
          pickupAddressSnapshot: fulfillment.pickupAddressSnapshot,
          deliveryMunicipalityId: deliveryMunicipalityId ?? null,
          // A snapshot: the saved address may be edited or deleted later, the
          // order must still say where it was going.
          deliveryAddress: address
            ? snapshotAddress(address, place)
            : (dto.deliveryAddress ?? null),
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
          {
            allowedLocationIds,
            // Pickup drains the customer's counter first; overflow lands at
            // sibling covering storages and flags the order for a transfer.
            preferredLocationId: fulfillment.pickupLocationId ?? undefined,
          },
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

    // Deliberately NOT awaited. Creating the attempt is a live call to the
    // gateway — seconds, sometimes many — and the order is already committed
    // and visible by now, so making the customer watch a spinner for it only
    // risks them abandoning a checkout that already succeeded. The order page
    // polls for the attempt and can start one itself if this fails.
    if (dto.saveAddress && dto.address && !dto.addressId) {
      // After the commit, and never fatal: the order is placed either way.
      try {
        await this.clientAddressesService.create(client.id, dto.address);
      } catch (err) {
        this.logger.error(
          `Could not save the address of order ${orderId} to the address book`,
          err instanceof Error ? err.stack : String(err),
        );
      }
    }

    void this.initiatePayment(orderId, gateway);

    return this.findOneForClient(client.id, orderId);
  }

  /**
   * The address this order ships to: a saved one (ownership-checked), or one
   * typed at checkout — persisted to the customer's book only if they asked.
   * Pickup orders have none.
   */
  private async resolveAddress(
    client: Client,
    dto: CheckoutDto,
  ): Promise<ClientAddress | null> {
    if (dto.fulfillmentType === FulfillmentType.PICKUP) return null;

    if (dto.addressId) {
      return this.clientAddressesService.findOneForClient(
        client.id,
        dto.addressId,
      );
    }
    if (!dto.address) return null;

    // Detached: the order snapshots it. Saving to the address book happens
    // only once the order exists — a checkout that fails must not leave the
    // customer with a new address (and a retry with a duplicate of it).
    return {
      ...dto.address,
      clientId: client.id,
      municipalityId: dto.address.municipalityId,
    } as ClientAddress;
  }

  // Human-readable place for the order's address snapshot.
  private async resolvePlace(
    address: ClientAddress,
  ): Promise<{ municipality: string; province: string } | null> {
    try {
      const municipality = await this.geographyService.getMunicipalityOrThrow(
        address.municipalityId,
      );
      const province = await this.geographyService.getProvinceOrThrow(
        municipality.provinceId,
      );
      return { municipality: municipality.name, province: province.name };
    } catch {
      // A municipality that left the catalog must not stop an order.
      return null;
    }
  }

  // Background payment initiation. Never throws: a gateway failure leaves the
  // order unpaid with no attempt, which the order page offers to retry.
  private async initiatePayment(
    orderId: string,
    gateway: PaymentGateway,
  ): Promise<void> {
    try {
      const order = (await this.orderRepository.findOne({
        where: { id: orderId },
      })) as Order;
      await this.paymentsService.createChargeForOrder(order, gateway);
    } catch (err) {
      this.logger.error(
        `Payment initiation failed for order ${orderId}`,
        err instanceof Error ? err.stack : String(err),
      );
    }
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
      await this.withPaymentMethods(orders),
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
    dto.paymentMethod = (
      await this.paymentsService.latestMethodsFor([order.id])
    ).get(order.id);
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
        `(${sinTildes('order.orderNumber')} OR ${sinTildes('client.email')}
          OR ${sinTildes('client.firstName')} OR ${sinTildes('client.lastName')})`,
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
    if (query.paymentMethod) {
      // El método de un pedido es el de su **último** intento, que es lo que
      // muestra la columna (`latestMethodsFor`). Un `EXISTS` sobre cualquier
      // intento sería más corto y mentiría: hay pedidos que probaron Tropipay y
      // reintentaron con otra cosa, y saldrían al filtrar por una pasarela
      // mientras la tabla muestra la otra.
      qb.andWhere(
        query.paymentMethod === SIN_METODO_DE_PAGO
          ? // `"order"` entrecomillado: es palabra reservada en SQL, y aquí dentro
            // no pasa por la sustitución de alias de TypeORM.
            `NOT EXISTS (SELECT 1 FROM payment_charges c WHERE c.order_id = "order"."id")`
          : `(SELECT c.provider FROM payment_charges c
                WHERE c.order_id = "order"."id"
                ORDER BY c.created_at DESC, c.id DESC
                LIMIT 1) = :paymentMethod`,
        query.paymentMethod === SIN_METODO_DE_PAGO
          ? {}
          : { paymentMethod: query.paymentMethod },
      );
    }
    if (query.needsTransfer) {
      // Pickup orders still holding RESERVED stock away from their counter —
      // derived from the reservations so it clears itself once settled.
      qb.andWhere(`order.fulfillment_type = 'pickup'`).andWhere(
        `EXISTS (SELECT 1 FROM inventory_reservations r
           WHERE r.order_id = order.id AND r.status = 'reserved'
             AND r.location_id <> order.pickup_location_id)`,
      );
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
      await this.withPaymentMethods(orders),
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
    dto.paymentMethod = (
      await this.paymentsService.latestMethodsFor([order.id])
    ).get(order.id);
    await this.attachReservationStorages(dto, order);
    return dto;
  }

  // Where the order's stock actually sits. A pickup order still holding
  // RESERVED stock at a storage other than its counter needs the admin to
  // coordinate a transfer before the customer shows up.
  private async attachReservationStorages(
    dto: OrderResponseDto,
    order: Order,
  ): Promise<void> {
    if (order.fulfillmentType !== FulfillmentType.PICKUP) return;

    const rows: {
      location_id: string;
      name: string;
      product_id: string;
      status: string;
      quantity: number;
    }[] = await this.orderRepository.manager.query(
      `SELECT r.location_id, sl.name, r.product_id, r.status,
              SUM(r.quantity)::int AS quantity
         FROM inventory_reservations r
         JOIN stock_locations sl ON sl.id = r.location_id
        WHERE r.order_id = $1 AND r.status IN ('reserved', 'confirmed')
        GROUP BY r.location_id, sl.name, r.product_id, r.status
        ORDER BY sl.name`,
      [order.id],
    );

    const storages = new Map<string, string>();
    for (const row of rows) storages.set(row.location_id, row.name);
    dto.reservationStorages = [...storages.entries()].map(
      ([locationId, locationName]) => ({ locationId, locationName }),
    );

    // The misplaced lines, grouped by source storage: one group = one transfer
    // operation the admin can run. Names come from the order's own snapshots.
    const nameByProduct = new Map(
      (order.items ?? []).map((item) => [
        item.productId,
        item.productNameSnapshot,
      ]),
    );
    const pending = new Map<
      string,
      NonNullable<OrderResponseDto['pendingTransfers']>[number]
    >();
    for (const row of rows) {
      if (row.status !== 'reserved') continue;
      if (row.location_id === order.pickupLocationId) continue;
      const group = pending.get(row.location_id) ?? {
        locationId: row.location_id,
        locationName: row.name,
        items: [],
      };
      group.items.push({
        productId: row.product_id,
        name: nameByProduct.get(row.product_id) ?? row.product_id,
        quantity: row.quantity,
      });
      pending.set(row.location_id, group);
    }
    dto.pendingTransfers = [...pending.values()];
    dto.needsTransfer = dto.pendingTransfers.length > 0;
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
        // The hold becomes a physical stock decrement, logged as an OUT sale.
        await this.inventoryService.confirmReservations(
          manager,
          order.id,
          user.id,
        );
      } else if (status === OrderStatus.CANCELLED) {
        // Releases holds; restocks (logged as IN) allocations already confirmed.
        await this.inventoryService.releaseReservations(
          manager,
          order.id,
          user.id,
        );
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
