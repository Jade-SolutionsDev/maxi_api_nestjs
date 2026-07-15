import { Inventory } from '../entities/inventory.entity';
import { InventoryOperation } from '../entities/inventory-operation.entity';
import { InventoryOperationItem } from '../entities/inventory-operation-item.entity';

export class InventoryResponseDto {
  id: string;
  locationId: string;
  productId: string;
  quantity: number;

  static fromEntity(row: Inventory): InventoryResponseDto {
    const dto = new InventoryResponseDto();
    dto.id = row.id;
    dto.locationId = row.locationId;
    dto.productId = row.productId;
    dto.quantity = row.quantity;
    return dto;
  }
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
