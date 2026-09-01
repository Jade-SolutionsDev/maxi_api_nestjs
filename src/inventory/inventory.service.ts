import { sinTildesSql } from '../common/search/accent-insensitive';
import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import { Product } from '../products/entities/product.entity';
import { StockLocationsService } from '../stock-locations/stock-locations.service';
import { User } from '../users/entities/user.entity';
import { CreateOperationDto } from './dto/create-operation.dto';
import {
  AggregatedInventoryDto,
  InventoryHistoryEventDto,
  InventoryResponseDto,
  OperationResponseDto,
  ProductStockLocationDto,
} from './dto/inventory-response.dto';
import { Inventory } from './entities/inventory.entity';
import {
  InventoryOperation,
  OperationType,
} from './entities/inventory-operation.entity';
import {
  InventoryReservation,
  ReservationStatus,
} from './entities/inventory-reservation.entity';
import { InventoryOperationItem } from './entities/inventory-operation-item.entity';

interface MergedItem {
  productId: string;
  quantity: number;
}

@Injectable()
export class InventoryService {
  constructor(
    @InjectRepository(Inventory)
    private readonly inventoryRepository: Repository<Inventory>,
    @InjectRepository(InventoryOperation)
    private readonly operationRepository: Repository<InventoryOperation>,
    @InjectRepository(InventoryOperationItem)
    private readonly itemRepository: Repository<InventoryOperationItem>,
    @InjectRepository(Product)
    private readonly productRepository: Repository<Product>,
    private readonly stockLocationsService: StockLocationsService,
    private readonly dataSource: DataSource,
  ) {}

  async listInventory(
    user: User,
    locationId: string,
  ): Promise<InventoryResponseDto[]> {
    await this.stockLocationsService.assertCanManage(user, locationId);
    const rows = await this.inventoryRepository.find({
      where: { locationId },
      order: { createdAt: 'DESC' },
    });
    return rows.map(InventoryResponseDto.fromEntity);
  }

  async listOperations(
    user: User,
    locationId: string,
  ): Promise<OperationResponseDto[]> {
    await this.stockLocationsService.assertCanManage(user, locationId);
    const operations = await this.operationRepository.find({
      where: { locationId },
      order: { createdAt: 'DESC' },
    });
    if (operations.length === 0) return [];
    const items = await this.itemRepository.find({
      where: { operationId: In(operations.map((o) => o.id)) },
    });
    return operations.map((op) =>
      OperationResponseDto.build(
        op,
        items.filter((i) => i.operationId === op.id),
      ),
    );
  }

  // Per-storage stock of one product across ALL storages (not grocer-scoped —
  // this is catalog info, consistent with the product's `amount` total). Only
  // storages that actually hold the product (quantity > 0) are returned.
  async stockByProduct(productId: string): Promise<ProductStockLocationDto[]> {
    const rows: {
      location_id: string;
      name: string;
      is_active: boolean;
      quantity: number;
      reserved_quantity: number;
    }[] = await this.inventoryRepository.manager.query(
      `SELECT i.location_id, sl.name, sl.is_active, i.quantity, i.reserved_quantity
           FROM inventory i
           JOIN stock_locations sl
             ON sl.id = i.location_id AND sl.deleted_at IS NULL
          WHERE i.product_id = $1 AND i.quantity > 0
          ORDER BY sl.is_active DESC, i.quantity DESC, sl.name ASC`,
      [productId],
    );
    if (rows.length === 0) return [];

    const locationIds = rows.map((r) => r.location_id);
    const coverage: { location_id: string; province: string }[] =
      await this.inventoryRepository.manager.query(
        `SELECT DISTINCT c.location_id, p.name AS province
           FROM stock_location_coverage c
           JOIN provinces p ON p.id = c.province_id
          WHERE c.location_id = ANY($1)
          ORDER BY p.name ASC`,
        [locationIds],
      );
    const provincesByLocation = new Map<string, string[]>();
    for (const c of coverage) {
      const list = provincesByLocation.get(c.location_id) ?? [];
      list.push(c.province);
      provincesByLocation.set(c.location_id, list);
    }

    return rows.map((r) => {
      const quantity = Number(r.quantity);
      const reservedQuantity = Number(r.reserved_quantity);
      return {
        locationId: r.location_id,
        locationName: r.name,
        provinces: provincesByLocation.get(r.location_id) ?? [],
        quantity,
        reservedQuantity,
        isActive: r.is_active,
        available: r.is_active ? Math.max(0, quantity - reservedQuantity) : 0,
      };
    });
  }

  // Admin cross-storage list: one row per product, stock rolled up across all
  // storages. `real` = SUM(quantity); `reserved` = SUM(reserved_quantity);
  // `available` = SUM(quantity - reserved) counting only enabled storages.
  // Returns the full filtered set (frontend paginates/sorts client-side).
  async aggregateByProduct(filters: {
    q?: string;
    departmentId?: string;
    categoryId?: string;
    atLocationId?: string;
    minStock?: number;
    maxStock?: number;
  }): Promise<AggregatedInventoryDto[]> {
    const params: unknown[] = [];
    const add = (v: unknown): string => {
      params.push(v);
      return `$${params.length}`;
    };

    const where: string[] = [];
    if (filters.q) {
      where.push(sinTildesSql('p.name', add(`%${filters.q}%`)));
    }
    if (filters.categoryId) {
      where.push(`p.category_id = ${add(filters.categoryId)}`);
    }
    if (filters.departmentId) {
      where.push(
        `EXISTS (SELECT 1 FROM categories cc
                  WHERE cc.id = p.category_id
                    AND cc.parent_id = ${add(filters.departmentId)})`,
      );
    }
    if (filters.atLocationId) {
      where.push(
        `EXISTS (SELECT 1 FROM inventory il
                  WHERE il.product_id = p.id
                    AND il.location_id = ${add(filters.atLocationId)})`,
      );
    }

    const having: string[] = [];
    if (filters.minStock != null) {
      having.push(`COALESCE(SUM(i.quantity), 0) >= ${add(filters.minStock)}`);
    }
    if (filters.maxStock != null) {
      having.push(`COALESCE(SUM(i.quantity), 0) <= ${add(filters.maxStock)}`);
    }

    const rows: {
      id: string;
      product_name: string;
      image_url: string | null;
      category_id: string | null;
      department_id: string | null;
      measure_unit: string;
      real: number;
      reserved: number;
      available: number;
      storage_count: number;
    }[] = await this.inventoryRepository.manager.query(
      `SELECT p.id AS id, p.name AS product_name, p.image_url,
              p.category_id, c.parent_id AS department_id, p.measure_unit,
              COALESCE(SUM(i.quantity), 0)::int AS real,
              COALESCE(SUM(i.reserved_quantity), 0)::int AS reserved,
              COALESCE(SUM(CASE WHEN sl.is_active AND sl.deleted_at IS NULL
                                THEN i.quantity - i.reserved_quantity
                                ELSE 0 END), 0)::int AS available,
              COUNT(DISTINCT i.location_id)::int AS storage_count
         FROM inventory i
         JOIN products p ON p.id = i.product_id AND p.deleted_at IS NULL
         LEFT JOIN categories c ON c.id = p.category_id
         LEFT JOIN stock_locations sl ON sl.id = i.location_id
        ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        GROUP BY p.id, p.name, p.image_url, p.category_id, c.parent_id, p.measure_unit
        ${having.length ? `HAVING ${having.join(' AND ')}` : ''}
        ORDER BY p.name ASC`,
      params,
    );

    return rows.map((r) => ({
      id: r.id,
      productName: r.product_name,
      imageUrl: r.image_url,
      categoryId: r.category_id,
      departmentId: r.department_id,
      measureUnit: r.measure_unit,
      real: Number(r.real),
      reserved: Number(r.reserved),
      available: Number(r.available),
      storageCount: Number(r.storage_count),
    }));
  }

  // Combined change timeline for one product OR one location: manual operations
  // (with the acting user) merged with order reservation events. Deltas only.
  async history(
    filter: { productId: string } | { locationId: string },
  ): Promise<InventoryHistoryEventDto[]> {
    const byProduct = 'productId' in filter;
    const id = byProduct ? filter.productId : filter.locationId;

    const opWhere = byProduct
      ? 'oi.product_id = $1'
      : '(o.location_id = $1 OR o.target_location_id = $1)';
    const ops: {
      type: string;
      product_id: string;
      product_name: string | null;
      quantity: number;
      location_id: string;
      location_name: string | null;
      target_location_id: string | null;
      target_location_name: string | null;
      note: string | null;
      order_id: string | null;
      created_by: string | null;
      first_name: string | null;
      last_name: string | null;
      created_at: Date;
    }[] = await this.inventoryRepository.manager.query(
      `SELECT o.type, oi.product_id, p.name AS product_name, oi.quantity,
              o.location_id, sl.name AS location_name,
              o.target_location_id, tl.name AS target_location_name,
              o.note, o.order_id, o.created_by,
              u."firstName" AS first_name, u."lastName" AS last_name,
              o.created_at
         FROM inventory_operation_items oi
         JOIN inventory_operations o ON o.id = oi.operation_id
         LEFT JOIN products p ON p.id = oi.product_id
         LEFT JOIN stock_locations sl ON sl.id = o.location_id
         LEFT JOIN stock_locations tl ON tl.id = o.target_location_id
         LEFT JOIN users u ON u.id = o.created_by
        WHERE ${opWhere}
        ORDER BY o.created_at DESC
        LIMIT 200`,
      [id],
    );

    const resWhere = byProduct ? 'r.product_id = $1' : 'r.location_id = $1';
    const reservations: {
      status: string;
      product_id: string;
      product_name: string | null;
      quantity: number;
      location_id: string;
      location_name: string | null;
      order_id: string;
      created_at: Date;
      updated_at: Date;
    }[] = await this.inventoryRepository.manager.query(
      `SELECT r.status, r.product_id, p.name AS product_name, r.quantity,
              r.location_id, sl.name AS location_name, r.order_id,
              r.created_at, r.updated_at
         FROM inventory_reservations r
         LEFT JOIN products p ON p.id = r.product_id
         LEFT JOIN stock_locations sl ON sl.id = r.location_id
        WHERE ${resWhere}
        ORDER BY r.created_at DESC
        LIMIT 200`,
      [id],
    );

    const events: InventoryHistoryEventDto[] = [];

    for (const o of ops) {
      const actorName =
        [o.first_name, o.last_name].filter(Boolean).join(' ').trim() || null;
      events.push({
        kind: 'operation',
        type: o.type,
        productId: o.product_id,
        productName: o.product_name ?? '',
        quantity: Number(o.quantity),
        locationId: o.location_id,
        locationName: o.location_name,
        targetLocationId: o.target_location_id,
        targetLocationName: o.target_location_name,
        note: o.note,
        actorId: o.created_by,
        actorName,
        orderId: o.order_id,
        createdAt: o.created_at,
      });
    }

    // Reservations contribute only the `reserved` hold — a hold is not a
    // physical movement. The confirm (sale OUT) and cancel-after-confirm
    // (restock IN) are real inventory_operations now, emitted above with their
    // orderId; re-deriving them here would double-count.
    for (const r of reservations) {
      events.push({
        kind: 'reservation',
        type: 'reserved',
        productId: r.product_id,
        productName: r.product_name ?? '',
        quantity: Number(r.quantity),
        locationId: r.location_id,
        locationName: r.location_name,
        targetLocationId: null,
        targetLocationName: null,
        note: null,
        actorId: null,
        actorName: null,
        orderId: r.order_id,
        createdAt: r.created_at,
      });
    }

    events.sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
    return events.slice(0, 200);
  }

  // Location timeline for the storage detail — grocer must manage the location.
  async locationHistory(
    user: User,
    locationId: string,
  ): Promise<InventoryHistoryEventDto[]> {
    await this.stockLocationsService.assertCanManage(user, locationId);
    return this.history({ locationId });
  }

  async createOperation(
    user: User,
    dto: CreateOperationDto,
  ): Promise<OperationResponseDto> {
    // Source access: managers always; a grocer must be assigned to it.
    await this.stockLocationsService.assertCanManage(user, dto.locationId);
    await this.assertProductsExist(dto.items.map((i) => i.productId));

    // Collapse duplicate product lines so each product is applied once.
    const items = this.mergeItems(dto.items);

    let targetLocationId: string | null = null;
    if (dto.type === OperationType.TRANSFER) {
      if (!dto.targetLocationId) {
        throw new BadRequestException(
          'targetLocationId is required for a transfer',
        );
      }
      if (dto.targetLocationId === dto.locationId) {
        throw new BadRequestException('Cannot transfer to the same storage');
      }
      await this.stockLocationsService.getActiveLocationOrThrow(
        dto.targetLocationId,
      );
      targetLocationId = dto.targetLocationId;
    }

    return this.dataSource.transaction(async (manager) => {
      for (const item of items) {
        if (dto.type === OperationType.IN) {
          await this.addStock(
            manager,
            dto.locationId,
            item.productId,
            item.quantity,
          );
        } else if (dto.type === OperationType.OUT) {
          await this.removeStock(
            manager,
            dto.locationId,
            item.productId,
            item.quantity,
          );
        } else {
          // TRANSFER: remove from the source, add to the destination.
          await this.removeStock(
            manager,
            dto.locationId,
            item.productId,
            item.quantity,
          );
          await this.addStock(
            manager,
            targetLocationId as string,
            item.productId,
            item.quantity,
          );
        }
      }

      const opRepo = manager.getRepository(InventoryOperation);
      const savedOp = await opRepo.save(
        opRepo.create({
          type: dto.type,
          locationId: dto.locationId,
          targetLocationId,
          note: dto.note ?? null,
          createdBy: user.id,
        }),
      );
      const itemRepo = manager.getRepository(InventoryOperationItem);
      const savedItems = await itemRepo.save(
        items.map((i) =>
          itemRepo.create({
            operationId: savedOp.id,
            productId: i.productId,
            quantity: i.quantity,
          }),
        ),
      );
      return OperationResponseDto.build(savedOp, savedItems);
    });
  }

  // ---------------- Order reservations (not exposed over HTTP) ----------------
  // Called by OrdersService inside its own transaction; every method takes the
  // caller's EntityManager so the order write and the stock math commit together.

  // Holds `quantity` of a product for an order, allocating greedily across
  // storages by available (quantity - reserved) desc. 409 when the total
  // available across all storages is insufficient.
  async reserve(
    manager: EntityManager,
    orderId: string,
    productId: string,
    quantity: number,
    opts: { allowedLocationIds?: string[]; preferredLocationId?: string } = {},
  ): Promise<void> {
    const repo = manager.getRepository(Inventory);
    // Only enabled storages can fulfil an order — never reserve from a disabled
    // or soft-deleted location. `allowedLocationIds` narrows that further to
    // the storages covering the customer's municipality, so an order never
    // holds stock somewhere the shop can't fulfil it from.
    const activeLocations: { id: string }[] = await manager.query(
      opts.allowedLocationIds
        ? `SELECT id FROM stock_locations WHERE is_active = true AND deleted_at IS NULL AND id = ANY($1)`
        : `SELECT id FROM stock_locations WHERE is_active = true AND deleted_at IS NULL`,
      opts.allowedLocationIds ? [opts.allowedLocationIds] : undefined,
    );
    const activeIds = activeLocations.map((l) => l.id);
    const rows =
      activeIds.length === 0
        ? []
        : await repo.find({
            where: { productId, locationId: In(activeIds) },
            lock: { mode: 'pessimistic_write' },
          });
    // Greedy by available desc; the preferred storage (the pickup counter)
    // drains first so overflow to sibling storages is the exception.
    rows.sort((a, b) => {
      if (opts.preferredLocationId) {
        const aPreferred = a.locationId === opts.preferredLocationId;
        const bPreferred = b.locationId === opts.preferredLocationId;
        if (aPreferred !== bPreferred) return aPreferred ? -1 : 1;
      }
      return (
        b.quantity - b.reservedQuantity - (a.quantity - a.reservedQuantity)
      );
    });

    const totalAvailable = rows.reduce(
      (sum, r) => sum + (r.quantity - r.reservedQuantity),
      0,
    );
    if (totalAvailable < quantity) {
      // Same error shape as the cart's assertStock: machine-readable available.
      throw new ConflictException({
        message: `Insufficient stock: only ${totalAvailable} available`,
        details: [
          {
            field: 'quantity',
            message: `Only ${totalAvailable} available`,
            available: totalAvailable,
          },
        ],
      });
    }

    const reservationRepo = manager.getRepository(InventoryReservation);
    let remaining = quantity;
    for (const row of rows) {
      if (remaining <= 0) break;
      const available = row.quantity - row.reservedQuantity;
      if (available <= 0) continue;
      const take = Math.min(available, remaining);
      row.reservedQuantity += take;
      await repo.save(row);
      await reservationRepo.save(
        reservationRepo.create({
          orderId,
          locationId: row.locationId,
          productId,
          quantity: take,
        }),
      );
      remaining -= take;
    }
  }

  // Order confirmed: the hold becomes a physical decrement, recorded as an OUT
  // operation in the movement ledger (so sales are reconstructable, not just
  // the manual in/out/transfer wizard). `userId` is the confirming admin.
  async confirmReservations(
    manager: EntityManager,
    orderId: string,
    userId: string,
  ): Promise<void> {
    // Capture what will be confirmed BEFORE settle flips their status.
    const toConfirm = await manager.getRepository(InventoryReservation).find({
      where: { orderId, status: ReservationStatus.RESERVED },
    });
    await this.settleReservations(
      manager,
      orderId,
      ReservationStatus.CONFIRMED,
      (row, n) => {
        row.quantity -= n;
        row.reservedQuantity -= n;
      },
    );
    await this.recordOrderMovement(manager, {
      type: OperationType.OUT,
      orderId,
      userId,
      reservations: toConfirm,
    });
  }

  // Order cancelled: release holds; restock allocations already confirmed
  // (cancel after confirmation) and record the return as an IN operation.
  // ponytail: restock assumes the goods return to the same storage they were
  // committed from. `userId` is the acting admin (present whenever a restock can
  // happen — client cancel is PENDING-only, so it has nothing to restock).
  async releaseReservations(
    manager: EntityManager,
    orderId: string,
    userId?: string,
    /**
     * Con qué se marca lo liberado. Por defecto «cancelada», que es lo que hace
     * una persona; la caducidad pasa `EXPIRED` para poder medir aparte cuánto
     * stock retienen los pedidos que nunca se pagan.
     */
    estadoFinal: ReservationStatus = ReservationStatus.CANCELLED,
  ): Promise<void> {
    await this.settleReservations(manager, orderId, estadoFinal, (row, n) => {
      row.reservedQuantity -= n;
    });
    const reservationRepo = manager.getRepository(InventoryReservation);
    const confirmed = await reservationRepo.find({
      where: { orderId, status: ReservationStatus.CONFIRMED },
    });
    const repo = manager.getRepository(Inventory);
    for (const reservation of confirmed) {
      const row = await repo.findOne({
        where: {
          locationId: reservation.locationId,
          productId: reservation.productId,
        },
        lock: { mode: 'pessimistic_write' },
      });
      if (row) {
        row.quantity += reservation.quantity;
        await repo.save(row);
      } else {
        await repo.save(
          repo.create({
            locationId: reservation.locationId,
            productId: reservation.productId,
            quantity: reservation.quantity,
          }),
        );
      }
      reservation.status = estadoFinal;
      await reservationRepo.save(reservation);
    }
    if (confirmed.length > 0) {
      if (!userId) {
        // A restock can only originate from an admin cancel, which always
        // carries a user — guard so the non-null created_by never silently breaks.
        throw new Error(
          'releaseReservations: userId required to restock a confirmed order',
        );
      }
      await this.recordOrderMovement(manager, {
        type: OperationType.IN,
        orderId,
        userId,
        reservations: confirmed,
      });
    }
  }

  // Writes the movement ledger for an order-driven stock change: one immutable
  // InventoryOperation per storage (with its item lines), inside the caller's
  // transaction. Mirrors createOperation's persistence, but stamped with the
  // orderId so sales/restocks are linked and distinguishable from manual ops.
  private async recordOrderMovement(
    manager: EntityManager,
    params: {
      type: OperationType;
      orderId: string;
      userId: string;
      reservations: InventoryReservation[];
    },
  ): Promise<void> {
    if (params.reservations.length === 0) return;
    // Group by storage, merging quantities per product.
    const byLocation = new Map<string, Map<string, number>>();
    for (const r of params.reservations) {
      const items = byLocation.get(r.locationId) ?? new Map<string, number>();
      items.set(r.productId, (items.get(r.productId) ?? 0) + r.quantity);
      byLocation.set(r.locationId, items);
    }
    const opRepo = manager.getRepository(InventoryOperation);
    const itemRepo = manager.getRepository(InventoryOperationItem);
    for (const [locationId, items] of byLocation) {
      const op = await opRepo.save(
        opRepo.create({
          type: params.type,
          locationId,
          targetLocationId: null,
          orderId: params.orderId,
          note: null,
          createdBy: params.userId,
        }),
      );
      await itemRepo.save(
        [...items].map(([productId, quantity]) =>
          itemRepo.create({ operationId: op.id, productId, quantity }),
        ),
      );
    }
  }

  // Applies `apply` to the inventory row of every still-reserved allocation of
  // the order, then finalizes those reservations with the matching status.
  private async settleReservations(
    manager: EntityManager,
    orderId: string,
    finalStatus: ReservationStatus,
    apply: (row: Inventory, quantity: number) => void,
  ): Promise<void> {
    const reservationRepo = manager.getRepository(InventoryReservation);
    const reservations = await reservationRepo.find({
      where: { orderId, status: ReservationStatus.RESERVED },
    });
    const repo = manager.getRepository(Inventory);
    for (const reservation of reservations) {
      const row = await repo.findOne({
        where: {
          locationId: reservation.locationId,
          productId: reservation.productId,
        },
        lock: { mode: 'pessimistic_write' },
      });
      if (row) {
        apply(row, reservation.quantity);
        await repo.save(row);
      }
      reservation.status = finalStatus;
      await reservationRepo.save(reservation);
    }
  }

  // ---------------- Internal helpers ----------------

  private mergeItems(items: MergedItem[]): MergedItem[] {
    const totals = new Map<string, number>();
    for (const item of items) {
      totals.set(
        item.productId,
        (totals.get(item.productId) ?? 0) + item.quantity,
      );
    }
    return [...totals.entries()].map(([productId, quantity]) => ({
      productId,
      quantity,
    }));
  }

  private async assertProductsExist(productIds: string[]): Promise<void> {
    const unique = [...new Set(productIds)];
    const count = await this.productRepository.count({
      where: { id: In(unique) },
    });
    if (count !== unique.length) {
      throw new BadRequestException('One or more products do not exist');
    }
  }

  // Locks the existing row for the transaction so concurrent operations can't
  // lose updates. ponytail: the create path relies on the unique (location,
  // product) index as the backstop for the rare concurrent first-insert race.
  private async addStock(
    manager: EntityManager,
    locationId: string,
    productId: string,
    quantity: number,
  ): Promise<void> {
    const repo = manager.getRepository(Inventory);
    const row = await repo.findOne({
      where: { locationId, productId },
      lock: { mode: 'pessimistic_write' },
    });
    if (row) {
      row.quantity += quantity;
      await repo.save(row);
    } else {
      await repo.save(repo.create({ locationId, productId, quantity }));
    }
  }

  private async removeStock(
    manager: EntityManager,
    locationId: string,
    productId: string,
    quantity: number,
  ): Promise<void> {
    const repo = manager.getRepository(Inventory);
    const row = await repo.findOne({
      where: { locationId, productId },
      lock: { mode: 'pessimistic_write' },
    });
    // Reserved stock is spoken for by pending orders — manual OUT/TRANSFER
    // operations can only move what is not on hold.
    const current = (row?.quantity ?? 0) - (row?.reservedQuantity ?? 0);
    if (current < quantity) {
      throw new BadRequestException(
        `Insufficient stock for product ${productId}: have ${current} available, need ${quantity}`,
      );
    }
    // row is guaranteed non-null here (current >= quantity >= 1).
    row!.quantity -= quantity;
    await repo.save(row!);
  }
}
