import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import { Product } from '../products/entities/product.entity';
import { StockLocationsService } from '../stock-locations/stock-locations.service';
import { User } from '../users/entities/user.entity';
import { CreateOperationDto } from './dto/create-operation.dto';
import {
  InventoryResponseDto,
  OperationResponseDto,
} from './dto/inventory-response.dto';
import { Inventory } from './entities/inventory.entity';
import {
  InventoryOperation,
  OperationType,
} from './entities/inventory-operation.entity';
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
    const current = row?.quantity ?? 0;
    if (current < quantity) {
      throw new BadRequestException(
        `Insufficient stock for product ${productId}: have ${current}, need ${quantity}`,
      );
    }
    // row is guaranteed non-null here (current >= quantity >= 1).
    row!.quantity = current - quantity;
    await repo.save(row!);
  }
}
