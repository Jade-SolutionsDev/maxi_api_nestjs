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
import { DataSource, EntityManager, IsNull, Repository } from 'typeorm';
import { CartService } from '../cart/cart.service';
import { CartItem } from '../cart/entities/cart-item.entity';
import { Client } from '../clients/entities/client.entity';
import {
  buildPaginatedResponse,
  getPaginationParams,
  PaginatedResponse,
} from '../common/dto/pagination.dto';
import { InventoryService } from '../inventory/inventory.service';
import {
  isSystemAdmin,
  PermissionsService,
} from '../permissions/permissions.service';
import { ProductsService } from '../products/products.service';
import { OrderEventKind } from '../order-events/entities/order-event.entity';
import { OrderEventsService } from '../order-events/order-events.service';
import { Role, User } from '../users/entities/user.entity';
import {
  AdminOrdersQueryDto,
  SIN_METODO_DE_PAGO,
} from './dto/admin-orders-query.dto';
import { CheckoutDto } from './dto/checkout.dto';
import { CorrectOrderDto } from './dto/correct-order.dto';
import { OrderResponseDto } from './dto/order-response.dto';
import { UpdateOrderItemsDto } from './dto/update-order-items.dto';
import { OrderItem } from './entities/order-item.entity';
import {
  CancellationReason,
  FulfillmentType,
  Order,
  OrderStatus,
  PaymentStatus,
} from './entities/order.entity';
import { ClientAddressesService } from '../client-addresses/client-addresses.service';
import { ClientAddress } from '../client-addresses/entities/client-address.entity';
import { FulfillmentService } from '../fulfillment/fulfillment.service';
import { GeographyService } from '../geography/geography.service';
import {
  PaymentMethodsService,
  ResolvedPaymentMethod,
} from '../payments/payment-methods.service';
import { PaymentsService } from '../payments/payments.service';

/**
 * Qué hace el stock en cada estado: retenido (reserva viva), comprometido
 * (ya descontado del almacén) o liberado. La corrección de superadmin mueve
 * el stock entre fases, no entre estados.
 */
type StockPhase = 'held' | 'committed' | 'released';
const stockPhase = (status: OrderStatus): StockPhase =>
  status === OrderStatus.PENDING
    ? 'held'
    : status === OrderStatus.CANCELLED
      ? 'released'
      : 'committed';

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

// Fulfillment steps non-admin staff may drive; confirm/cancel (which move
// stock and commit the sale) and payment stay with ADMIN+.
const STAFF_TARGETS = [
  OrderStatus.PROCESSING,
  OrderStatus.SHIPPED,
  OrderStatus.DELIVERED,
];

// The fulfillment chain in order, for direct jumps (cancelled sits outside).
const FORWARD_CHAIN = [
  OrderStatus.PENDING,
  OrderStatus.CONFIRMED,
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

/**
 * Quién recibe el pedido. La dirección lo lleva cuando hay dirección; en una
 * recogida no la hay, y entonces viene suelto en `contact`.
 */
const snapshotContact = (
  source: {
    recipientName?: string | null;
    idCard?: string | null;
    contactPhone?: string | null;
  } | null,
): Record<string, unknown> | null => {
  if (!source) return null;
  const recipientName = source.recipientName?.trim() || null;
  const idCard = source.idCard?.trim() || null;
  const contactPhone = source.contactPhone?.trim() || null;
  // Un objeto con los tres campos en null no dice nada y ensucia el jsonb.
  if (!recipientName && !idCard && !contactPhone) return null;
  return { recipientName, idCard, contactPhone };
};

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
    private readonly permissionsService: PermissionsService,
    private readonly orderEvents: OrderEventsService,
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
    // En recogida no hay dirección ninguna, así que estos datos solo pueden
    // llegar sueltos. Sin ellos nadie sabe a quién entregar en el mostrador.
    if (fulfillment.type === FulfillmentType.PICKUP && !dto.contact) {
      throw new BadRequestException(
        'Faltan los datos de quien recoge el pedido',
      );
    }

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
    const resolvedPayment = await this.paymentMethodsService.resolve(
      dto.paymentMethod,
    );

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
          // `contact` manda sobre la dirección: es lo que el cliente acaba de
          // escribir en este checkout, mientras que la dirección guardada
          // puede llevar meses ahí con otro destinatario.
          contactSnapshot: snapshotContact(dto.contact ?? address),
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
      await this.orderEvents.record(manager, {
        orderId: order.id,
        kind: OrderEventKind.CREATED,
        actor: { clientId: client.id },
        field: 'status',
        nextValue: OrderStatus.PENDING,
        meta: {
          total,
          fulfillmentType: fulfillment.type,
          paymentMethod: dto.paymentMethod ?? null,
        },
      });
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

    void this.initiatePayment(orderId, resolvedPayment);

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
    resolved: ResolvedPaymentMethod,
  ): Promise<void> {
    try {
      const order = (await this.orderRepository.findOne({
        where: { id: orderId },
      })) as Order;
      await this.paymentsService.createChargeForOrder(order, resolved);
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
      const previous = order.status;
      order.status = OrderStatus.CANCELLED;
      await manager.getRepository(Order).save(order);
      await this.orderEvents.record(manager, {
        orderId: order.id,
        kind: OrderEventKind.STATUS_CHANGED,
        actor: { clientId },
        field: 'status',
        previousValue: previous,
        nextValue: OrderStatus.CANCELLED,
        reason: 'Cancelado por el cliente desde la tienda',
      });
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
    direct = false,
  ): Promise<OrderResponseDto> {
    const order = await this.orderRepository.findOne({ where: { id } });
    if (!order) {
      throw new NotFoundException(`Order with id "${id}" not found`);
    }

    if (direct) {
      await this.assertDirectJump(user, order, status);
    } else {
      if (!TRANSITIONS[order.status].includes(status)) {
        throw new ConflictException(
          `Cannot move order from "${order.status}" to "${status}"`,
        );
      }
      // Confirm/cancel commit or release stock — admin-level decisions. Any
      // non-admin granted `orders:update-status` is limited to advancing
      // fulfillment.
      if (!isSystemAdmin(user.role) && !STAFF_TARGETS.includes(status)) {
        throw new ForbiddenException(
          'Non-admin staff can only advance fulfillment (processing, shipped, delivered)',
        );
      }
    }

    // A jump still owes the side effects of the steps it skips: stock is
    // committed exactly once when the order passes (or lands on) confirmed,
    // and released when it lands on cancelled.
    const crossesConfirmed =
      order.status === OrderStatus.PENDING &&
      status !== OrderStatus.CANCELLED &&
      FORWARD_CHAIN.indexOf(status) >=
        FORWARD_CHAIN.indexOf(OrderStatus.CONFIRMED);

    await this.dataSource.transaction(async (manager) => {
      if (crossesConfirmed) {
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
      const previous = order.status;
      order.status = status;
      await manager.getRepository(Order).save(order);
      await this.orderEvents.record(manager, {
        orderId: order.id,
        kind: OrderEventKind.STATUS_CHANGED,
        actor: { userId: user.id },
        field: 'status',
        previousValue: previous,
        nextValue: status,
        meta: direct ? { direct: true } : null,
      });
    });
    return this.findOneAdmin(id);
  }

  // Direct jumps skip the step chain but never its rules of physics: forward
  // only (or to cancelled), never out of a terminal state, and reserved for
  // whoever runs manual in-store sales — a grantable permission, so admins
  // decide per role. The step-by-step path stays the safe default.
  private async assertDirectJump(
    user: User,
    order: Order,
    status: OrderStatus,
  ): Promise<void> {
    const allowed = await this.permissionsService.hasPermission(
      user.id,
      user.role,
      'orders',
      'update-status-direct',
    );
    if (!allowed) {
      throw new ForbiddenException(
        'You need the direct status-change permission to do this',
      );
    }
    if (TRANSITIONS[order.status].length === 0) {
      throw new ConflictException(
        `Order is already ${order.status}; nothing to change`,
      );
    }
    if (status === order.status) {
      throw new ConflictException(`Order is already ${status}`);
    }
    if (
      status !== OrderStatus.CANCELLED &&
      FORWARD_CHAIN.indexOf(status) <= FORWARD_CHAIN.indexOf(order.status)
    ) {
      throw new ConflictException(
        `Cannot move order backwards from "${order.status}" to "${status}"`,
      );
    }
  }

  /**
   * «Restablecer orden»: devuelve a `pending` un pedido cancelado y vuelve a
   * apartar su stock. Toca SOLO el estado del pedido — el del pago queda como
   * estaba — y reinicia el plazo de pago vía `reinstatedAt`: si nadie lo paga
   * dentro de la ventana, la caducidad lo vuelve a cancelar. Si falta stock de
   * alguna línea no se cambia nada y se responde 409 nombrando el producto.
   * Solo administradores (el controlador lo exige por rol).
   */
  async reinstate(user: User, id: string): Promise<OrderResponseDto> {
    const order = await this.orderRepository.findOne({ where: { id } });
    if (!order) {
      throw new NotFoundException(`Order with id "${id}" not found`);
    }
    if (order.status !== OrderStatus.CANCELLED) {
      throw new ConflictException(
        `Only cancelled orders can be reinstated (current status: "${order.status}")`,
      );
    }
    if (
      order.cancellationReason ===
      CancellationReason.PAID_AFTER_EXPIRY_OUT_OF_STOCK
    ) {
      throw new ConflictException(
        'This order was paid after expiring and its stock was gone: it needs a refund, not a reinstatement',
      );
    }

    // Same storage rules as a fresh checkout: only storages covering the
    // delivery municipality, and the pickup counter first for a pickup.
    const allowedLocationIds = await this.allowedLocationsFor(order);

    await this.dataSource.transaction(async (manager) => {
      await this.reserveOrderItems(
        manager,
        order,
        allowedLocationIds,
        'restablecer el pedido',
      );
      const previous = order.status;
      order.status = OrderStatus.PENDING;
      order.cancellationReason = null;
      order.reinstatedAt = new Date();
      order.reinstatedBy = user.id;
      await manager.getRepository(Order).save(order);
      await this.orderEvents.record(manager, {
        orderId: order.id,
        kind: OrderEventKind.REINSTATED,
        actor: { userId: user.id },
        field: 'status',
        previousValue: previous,
        nextValue: OrderStatus.PENDING,
        reason:
          'Restablecida desde la administración; el plazo de pago vuelve a empezar',
      });
    });
    this.logger.log(
      `Order ${order.orderNumber ?? order.id} reinstated by user ${user.id}: back to pending, stock re-reserved`,
    );
    return this.findOneAdmin(id);
  }

  // Manual override (refunds, gateway-outage corrections). Guarded so an
  // admin can't produce nonsense like paid -> pending.
  async updatePaymentStatus(
    user: User,
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
    const previous = order.paymentStatus;
    order.paymentStatus = paymentStatus;
    await this.orderRepository.save(order);
    await this.orderEvents.record(null, {
      orderId: order.id,
      kind: OrderEventKind.PAYMENT_STATUS_CHANGED,
      actor: { userId: user.id },
      field: 'paymentStatus',
      previousValue: previous,
      nextValue: paymentStatus,
      reason: 'Marcado a mano desde la administración',
    });
    return this.findOneAdmin(id);
  }

  /** Almacenes donde este pedido puede apartar stock: los que cubren su municipio, y su mostrador. */
  private async allowedLocationsFor(
    order: Order,
  ): Promise<string[] | undefined> {
    const coveringIds = order.deliveryMunicipalityId
      ? await this.productsService.coveringLocationIds({
          municipalityId: order.deliveryMunicipalityId,
        })
      : undefined;
    return coveringIds && order.pickupLocationId
      ? [...new Set([...coveringIds, order.pickupLocationId])]
      : coveringIds;
  }

  /** Vuelve a apartar cada línea del pedido; 409 nombrando el producto si falta. */
  private async reserveOrderItems(
    manager: EntityManager,
    order: Order,
    allowedLocationIds: string[] | undefined,
    purpose: string,
  ): Promise<void> {
    const items = await manager
      .getRepository(OrderItem)
      .find({ where: { orderId: order.id } });
    for (const item of items) {
      try {
        await this.inventoryService.reserve(
          manager,
          order.id,
          item.productId,
          item.quantity,
          {
            allowedLocationIds,
            preferredLocationId: order.pickupLocationId ?? undefined,
          },
        );
      } catch (err) {
        if (err instanceof ConflictException) {
          throw new ConflictException(
            `No hay stock suficiente de "${item.productNameSnapshot}" (${item.quantity}) para ${purpose}`,
          );
        }
        throw err;
      }
    }
  }

  /**
   * Corrección de superadministrador: cualquier estado de pedido y de pago,
   * en cualquier dirección, con el efecto que toca sobre el stock:
   *
   *   liberado (cancelado)        → retenido (pendiente): vuelve a apartar
   *   liberado                    → comprometido (confirmado en adelante): aparta y descuenta
   *   retenido                    → comprometido: descuenta
   *   retenido                    → liberado: libera
   *   comprometido                → retenido: devuelve al almacén y vuelve a apartar
   *   comprometido                → liberado: devuelve al almacén
   *
   * Si el resultado es «pendiente y sin pagar», el plazo de pago vuelve a
   * empezar desde ahora, como en un restablecimiento: si no, un pedido viejo
   * caducaría en el siguiente barrido. Todo queda en el historial con el
   * motivo y la marca de corrección.
   */
  async correct(
    user: User,
    id: string,
    dto: CorrectOrderDto,
  ): Promise<OrderResponseDto> {
    if (user.role !== Role.SUPER_ADMIN) {
      throw new ForbiddenException(
        'Only a super admin can correct an order freely',
      );
    }
    if (dto.status === undefined && dto.paymentStatus === undefined) {
      throw new BadRequestException(
        'Nothing to correct: pass a status, a payment status, or both',
      );
    }
    const order = await this.orderRepository.findOne({ where: { id } });
    if (!order) {
      throw new NotFoundException(`Order with id "${id}" not found`);
    }
    const fromStatus = order.status;
    const toStatus = dto.status ?? order.status;
    const fromPayment = order.paymentStatus;
    const toPayment = dto.paymentStatus ?? order.paymentStatus;
    if (fromStatus === toStatus && fromPayment === toPayment) {
      throw new ConflictException('The order is already in that state');
    }

    const allowedLocationIds =
      stockPhase(fromStatus) !== stockPhase(toStatus) &&
      stockPhase(toStatus) !== 'released'
        ? await this.allowedLocationsFor(order)
        : undefined;

    await this.dataSource.transaction(async (manager) => {
      if (fromStatus !== toStatus) {
        const from = stockPhase(fromStatus);
        const to = stockPhase(toStatus);
        if (from !== to) {
          if (from === 'committed') {
            // Devuelve al almacén lo que ya se había descontado (queda como IN).
            await this.inventoryService.releaseReservations(
              manager,
              order.id,
              user.id,
            );
          } else if (from === 'held' && to === 'released') {
            await this.inventoryService.releaseReservations(
              manager,
              order.id,
              user.id,
            );
          }
          if (to === 'held' || to === 'committed') {
            if (from !== 'held') {
              await this.reserveOrderItems(
                manager,
                order,
                allowedLocationIds,
                'corregir el pedido',
              );
            }
            if (to === 'committed') {
              await this.inventoryService.confirmReservations(
                manager,
                order.id,
                user.id,
              );
            }
          }
        }
        order.status = toStatus;
        if (toStatus === OrderStatus.CANCELLED) {
          order.cancellationReason = null;
        } else if (fromStatus === OrderStatus.CANCELLED) {
          order.cancellationReason = null;
        }
      }
      if (fromPayment !== toPayment) {
        order.paymentStatus = toPayment;
      }
      if (
        order.status === OrderStatus.PENDING &&
        order.paymentStatus !== PaymentStatus.PAID &&
        (fromStatus !== OrderStatus.PENDING ||
          fromPayment === PaymentStatus.PAID)
      ) {
        order.reinstatedAt = new Date();
        order.reinstatedBy = user.id;
      }
      await manager.getRepository(Order).save(order);

      if (fromStatus !== toStatus) {
        await this.orderEvents.record(manager, {
          orderId: order.id,
          kind: OrderEventKind.STATUS_CHANGED,
          actor: { userId: user.id },
          field: 'status',
          previousValue: fromStatus,
          nextValue: toStatus,
          reason: dto.reason,
          meta: { correction: true },
        });
      }
      if (fromPayment !== toPayment) {
        await this.orderEvents.record(manager, {
          orderId: order.id,
          kind: OrderEventKind.PAYMENT_STATUS_CHANGED,
          actor: { userId: user.id },
          field: 'paymentStatus',
          previousValue: fromPayment,
          nextValue: toPayment,
          reason: dto.reason,
          meta: { correction: true },
        });
      }
    });
    this.logger.warn(
      `Order ${order.orderNumber ?? order.id} corrected by super admin ${user.id}: ` +
        `${fromStatus}/${fromPayment} -> ${toStatus}/${toPayment} (${dto.reason})`,
    );
    return this.findOneAdmin(id);
  }

  /**
   * Corrección de las líneas de un pedido (capa 3): cambiar cantidades, quitar
   * productos y añadir otros, con el total recalculado y el stock puesto al
   * día. Solo superadministradores.
   *
   * Se recibe el pedido **como debe quedar** y aquí se deduce qué cambió. El
   * stock se mueve según la fase en la que esté el pedido:
   *
   *   cancelado (liberado)  → no se toca stock: no hay nada apartado
   *   pendiente (retenido)  → sube: aparta la diferencia; baja: la suelta
   *   confirmado en adelante (comprometido) → sube: aparta y descuenta la
   *                            diferencia (queda como salida); baja: la devuelve
   *                            al almacén (queda como entrada)
   *
   * Las bajadas se aplican antes que las subidas: quien cambia un producto por
   * otro libera stock que la subida puede necesitar. Si falta stock para alguna
   * subida, no se guarda nada y se responde 409 nombrando el producto.
   */
  async updateItems(
    user: User,
    id: string,
    dto: UpdateOrderItemsDto,
  ): Promise<OrderResponseDto> {
    if (user.role !== Role.SUPER_ADMIN) {
      throw new ForbiddenException(
        'Only a super admin can edit the lines of an order',
      );
    }
    const productIds = dto.items.map((line) => line.productId);
    if (new Set(productIds).size !== productIds.length) {
      throw new BadRequestException(
        'Un producto no puede aparecer dos veces; súmalo en una sola línea',
      );
    }
    const order = await this.orderRepository.findOne({
      where: { id },
      relations: { items: true },
    });
    if (!order) {
      throw new NotFoundException(`Order with id "${id}" not found`);
    }

    const current = new Map(
      (order.items ?? []).map((item) => [item.productId, item]),
    );
    // El catálogo solo hace falta para las líneas nuevas: las que ya estaban
    // conservan su nombre y su precio de entonces.
    const incoming = await this.resolveLines(dto.items, current);

    const changes: Record<string, unknown>[] = [];
    for (const line of incoming) {
      const existing = current.get(line.productId);
      if (!existing) {
        changes.push({
          type: 'added',
          productId: line.productId,
          name: line.name,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
        });
        continue;
      }
      if (existing.quantity !== line.quantity) {
        changes.push({
          type: 'quantity',
          productId: line.productId,
          name: line.name,
          from: existing.quantity,
          to: line.quantity,
        });
      }
      if (Number(existing.unitPrice) !== Number(line.unitPrice)) {
        changes.push({
          type: 'price',
          productId: line.productId,
          name: line.name,
          from: Number(existing.unitPrice).toFixed(2),
          to: line.unitPrice.toFixed(2),
        });
      }
    }
    const incomingIds = new Set(incoming.map((line) => line.productId));
    for (const item of current.values()) {
      if (!incomingIds.has(item.productId)) {
        changes.push({
          type: 'removed',
          productId: item.productId,
          name: item.productNameSnapshot,
          quantity: item.quantity,
        });
      }
    }
    if (changes.length === 0) {
      throw new ConflictException('El pedido ya tiene esas líneas');
    }

    const phase = stockPhase(order.status);
    const allowedLocationIds =
      phase === 'released' ? undefined : await this.allowedLocationsFor(order);

    const previousTotal = Number(order.total);
    const subtotal = incoming.reduce(
      (sum, line) => sum + Math.round(line.unitPrice * line.quantity * 100),
      0,
    );
    const nextSubtotal = (subtotal / 100).toFixed(2);
    const nextTotal = (subtotal / 100 + Number(order.deliveryFee)).toFixed(2);

    await this.dataSource.transaction(async (manager) => {
      if (phase !== 'released') {
        // Primero lo que libera stock (quitadas y bajadas), después lo que lo
        // pide: cambiar un producto por otro no debe fallar por un hueco que la
        // propia corrección acaba de abrir.
        for (const item of current.values()) {
          const line = incoming.find((l) => l.productId === item.productId);
          const drop = line ? item.quantity - line.quantity : item.quantity;
          if (drop > 0) {
            await this.inventoryService.releaseProductUnits(
              manager,
              order.id,
              item.productId,
              drop,
              user.id,
            );
          }
        }
        for (const line of incoming) {
          const existing = current.get(line.productId);
          const rise = line.quantity - (existing?.quantity ?? 0);
          if (rise <= 0) continue;
          try {
            await this.inventoryService.reserve(
              manager,
              order.id,
              line.productId,
              rise,
              {
                allowedLocationIds,
                preferredLocationId: order.pickupLocationId ?? undefined,
              },
            );
          } catch (err) {
            if (err instanceof ConflictException) {
              throw new ConflictException(
                `No hay stock suficiente de "${line.name}" (faltan ${rise}) para corregir el pedido`,
              );
            }
            throw err;
          }
          if (phase === 'committed') {
            // El resto del pedido ya salió del almacén; esta parte se iguala.
            await this.inventoryService.confirmProductReservations(
              manager,
              order.id,
              line.productId,
              user.id,
            );
          }
        }
      }

      const itemRepo = manager.getRepository(OrderItem);
      for (const item of current.values()) {
        if (!incomingIds.has(item.productId)) await itemRepo.remove(item);
      }
      for (const line of incoming) {
        const existing = current.get(line.productId);
        const lineTotal = (
          Math.round(line.unitPrice * line.quantity * 100) / 100
        ).toFixed(2);
        if (existing) {
          existing.quantity = line.quantity;
          existing.unitPrice = line.unitPrice.toFixed(2);
          existing.lineTotal = lineTotal;
          await itemRepo.save(existing);
        } else {
          await itemRepo.save(
            itemRepo.create({
              orderId: order.id,
              productId: line.productId,
              productNameSnapshot: line.name,
              unitPrice: line.unitPrice.toFixed(2),
              quantity: line.quantity,
              lineTotal,
            }),
          );
        }
      }

      order.subtotal = nextSubtotal;
      order.total = nextTotal;
      await manager.getRepository(Order).save(order);

      await this.orderEvents.record(manager, {
        orderId: order.id,
        kind: OrderEventKind.ITEMS_CHANGED,
        actor: { userId: user.id },
        field: 'items',
        reason: dto.reason,
        meta: { correction: true, changes },
      });
      if (previousTotal !== Number(nextTotal)) {
        await this.orderEvents.record(manager, {
          orderId: order.id,
          kind: OrderEventKind.TOTAL_CHANGED,
          actor: { userId: user.id },
          field: 'total',
          previousValue: previousTotal.toFixed(2),
          nextValue: nextTotal,
          reason: dto.reason,
          meta: {
            correction: true,
            subtotal: nextSubtotal,
            deliveryFee: order.deliveryFee,
            // Con el pedido ya cobrado, la diferencia es dinero que hay que
            // cobrar (positiva) o devolver (negativa) fuera del sistema.
            paidDifference:
              order.paymentStatus === PaymentStatus.PAID
                ? (Number(nextTotal) - previousTotal).toFixed(2)
                : undefined,
          },
        });
      }
    });

    this.logger.warn(
      `Order ${order.orderNumber ?? order.id} lines corrected by super admin ${user.id}: ` +
        `${changes.length} change(s), total ${previousTotal.toFixed(2)} -> ${nextTotal} (${dto.reason})`,
    );
    return this.findOneAdmin(id);
  }

  /**
   * Cada línea pedida, con el nombre y el precio que le tocan: las que ya
   * estaban conservan los suyos (salvo que se mande otro precio), y las nuevas
   * los toman del catálogo. Un producto nuevo tiene que existir y estar a la
   * venta; uno retirado del catálogo puede seguir en el pedido que lo compró,
   * pero no se añade a otro.
   */
  private async resolveLines(
    lines: UpdateOrderItemsDto['items'],
    current: Map<string, OrderItem>,
  ): Promise<
    { productId: string; name: string; quantity: number; unitPrice: number }[]
  > {
    const resolved: {
      productId: string;
      name: string;
      quantity: number;
      unitPrice: number;
    }[] = [];
    for (const line of lines) {
      const existing = current.get(line.productId);
      if (existing) {
        resolved.push({
          productId: line.productId,
          name: existing.productNameSnapshot,
          quantity: line.quantity,
          unitPrice: line.unitPrice ?? Number(existing.unitPrice),
        });
        continue;
      }
      const product = await this.productsService.findOne(line.productId);
      if (!product.isActive || product.deletedAt) {
        throw new ConflictException(
          `"${product.name}" no está a la venta; no se puede añadir al pedido`,
        );
      }
      resolved.push({
        productId: line.productId,
        name: product.name,
        quantity: line.quantity,
        // Misma fórmula que el carrito y la ficha de producto.
        unitPrice:
          line.unitPrice ??
          Math.round(
            Number(product.basePrice) *
              (1 - Number(product.discount) / 100) *
              100,
          ) / 100,
      });
    }
    return resolved;
  }

  /** Todos los intentos de pago del pedido, del más reciente al más antiguo. */
  async listPaymentAttempts(id: string) {
    const exists = await this.orderRepository.findOne({
      where: { id },
      select: { id: true },
    });
    if (!exists) {
      throw new NotFoundException(`Order with id "${id}" not found`);
    }
    const charges = await this.paymentsService.listChargesFor(id);
    return charges.map((charge) => this.paymentsService.toDto(charge));
  }

  /** Quita un intento de pago que nunca se completó. Solo superadministradores. */
  async removePaymentAttempt(
    user: User,
    id: string,
    chargeId: string,
    reason: string,
  ): Promise<OrderResponseDto> {
    if (user.role !== Role.SUPER_ADMIN) {
      throw new ForbiddenException(
        'Only a super admin can remove a payment attempt',
      );
    }
    const order = await this.orderRepository.findOne({ where: { id } });
    if (!order) {
      throw new NotFoundException(`Order with id "${id}" not found`);
    }
    const removed = await this.paymentsService.removeAttempt(id, chargeId);
    if (order.paymentRef === removed.reference) {
      order.paymentRef = null;
      await this.orderRepository.save(order);
    }
    await this.orderEvents.record(null, {
      orderId: order.id,
      kind: OrderEventKind.PAYMENT_ATTEMPT_REMOVED,
      actor: { userId: user.id },
      reason,
      meta: {
        correction: true,
        provider: removed.provider,
        reference: removed.reference,
        chargeStatus: removed.status,
      },
    });
    return this.findOneAdmin(id);
  }

  /** Historial del pedido, del más antiguo al más reciente. */
  async listEvents(id: string) {
    const exists = await this.orderRepository.findOne({
      where: { id },
      select: { id: true },
    });
    if (!exists) {
      throw new NotFoundException(`Order with id "${id}" not found`);
    }
    return this.orderEvents.listForOrder(id);
  }
}
