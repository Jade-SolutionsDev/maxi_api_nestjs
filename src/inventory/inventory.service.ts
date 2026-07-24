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
      quantity: number;
      reserved_quantity: number;
    }[] = await this.inventoryRepository.manager.query(
      `SELECT i.location_id, sl.name, i.quantity, i.reserved_quantity
           FROM inventory i
           JOIN stock_locations sl
             ON sl.id = i.location_id AND sl.deleted_at IS NULL
          WHERE i.product_id = $1 AND i.quantity > 0
          ORDER BY i.quantity DESC, sl.name ASC`,
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

    return rows.map((r) => ({
      locationId: r.location_id,
      locationName: r.name,
      provinces: provincesByLocation.get(r.location_id) ?? [],
      quantity: Number(r.quantity),
      reservedQuantity: Number(r.reserved_quantity),
    }));
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
  ): Promise<void> {
    const repo = manager.getRepository(Inventory);
    const rows = await repo.find({
      where: { productId },
      lock: { mode: 'pessimistic_write' },
    });
    rows.sort(
      (a, b) =>
        b.quantity - b.reservedQuantity - (a.quantity - a.reservedQuantity),
    );

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

  // Order confirmed: the hold becomes a physical decrement.
  async confirmReservations(
    manager: EntityManager,
    orderId: string,
  ): Promise<void> {
    await this.settleReservations(
      manager,
      orderId,
      ReservationStatus.CONFIRMED,
      (row, n) => {
        row.quantity -= n;
        row.reservedQuantity -= n;
      },
    );
  }

  // Order cancelled: release holds; restock allocations already confirmed
  // (cancel after confirmation). ponytail: restock assumes the goods return to
  // the same storage they were committed from.
  async releaseReservations(
    manager: EntityManager,
    orderId: string,
  ): Promise<void> {
    await this.settleReservations(
      manager,
      orderId,
      ReservationStatus.CANCELLED,
      (row, n) => {
        row.reservedQuantity -= n;
      },
    );
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
      reservation.status = ReservationStatus.CANCELLED;
      await reservationRepo.save(reservation);
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
