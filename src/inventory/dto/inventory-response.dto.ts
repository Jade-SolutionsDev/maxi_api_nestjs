import { Inventory } from '../entities/inventory.entity';
import { InventoryOperation } from '../entities/inventory-operation.entity';
import { InventoryOperationItem } from '../entities/inventory-operation-item.entity';

export class InventoryResponseDto {
  id: string;
  locationId: string;
  productId: string;
  quantity: number;
  reservedQuantity: number;
  /** Sellable at this storage: quantity - reservedQuantity. */
  available: number;

  static fromEntity(row: Inventory): InventoryResponseDto {
    const dto = new InventoryResponseDto();
    dto.id = row.id;
    dto.locationId = row.locationId;
    dto.productId = row.productId;
    dto.quantity = row.quantity;
    dto.reservedQuantity = row.reservedQuantity;
    dto.available = Math.max(0, row.quantity - row.reservedQuantity);
    return dto;
  }
}

/** One storage's stock of a given product, for the product detail breakdown. */
export class ProductStockLocationDto {
  locationId: string;
  locationName: string;
  /** Names of the provinces this storage covers (may be empty). */
  provinces: string[];
  quantity: number;
  /** Units held by pending orders; quantity - reservedQuantity is sellable. */
  reservedQuantity: number;
  /** Whether the storage is enabled. Disabled storages contribute 0 available. */
  isActive: boolean;
  /** Sellable here: quantity - reservedQuantity, or 0 when the storage is disabled. */
  available: number;
}

/**
 * One product's stock rolled up across ALL storages, for the admin inventory
 * list. `id` is the product id (react-admin record key + detail route).
 */
export class AggregatedInventoryDto {
  id: string;
  productName: string;
  imageUrl: string | null;
  categoryId: string | null;
  departmentId: string | null;
  measureUnit: string;
  /** Physical total across every storage. */
  real: number;
  /** Held by pending orders across every storage. */
  reserved: number;
  /** Sellable: (quantity - reserved) summed over ENABLED storages only. */
  available: number;
  /** Number of storages holding this product. */
  storageCount: number;
}

/**
 * One entry in a stock change timeline — a manual operation (IN/OUT/TRANSFER,
 * with the acting user) or an order-driven reservation event (reserved/
 * confirmed/cancelled, with the order reference). Deltas only; no running balance.
 */
export class InventoryHistoryEventDto {
  kind: 'operation' | 'reservation';
  /** IN | OUT | TRANSFER | reserved | confirmed | cancelled */
  type: string;
  productId: string;
  productName: string;
  quantity: number;
  locationId: string;
  locationName: string | null;
  /** Transfer destination (operations only). */
  targetLocationId: string | null;
  targetLocationName: string | null;
  note: string | null;
  /** Back-office user who ran a manual operation; null for order movements. */
  actorId: string | null;
  actorName: string | null;
  /** Order reference for reservation events; null for manual operations. */
  orderId: string | null;
  createdAt: Date;
}

export class OperationResponseDto {
  id: string;
  type: string;
  locationId: string;
  targetLocationId: string | null;
  note: string | null;
  createdBy: string;
  createdAt: Date;
  items: { productId: string; quantity: number }[];

  static build(
    operation: InventoryOperation,
    items: InventoryOperationItem[],
  ): OperationResponseDto {
    const dto = new OperationResponseDto();
    dto.id = operation.id;
    dto.type = operation.type;
    dto.locationId = operation.locationId;
    dto.targetLocationId = operation.targetLocationId;
    dto.note = operation.note;
    dto.createdBy = operation.createdBy;
    dto.createdAt = operation.createdAt;
    dto.items = items.map((i) => ({
      productId: i.productId,
      quantity: i.quantity,
    }));
    return dto;
  }
}
