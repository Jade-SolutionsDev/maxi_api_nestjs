import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

// One product line within an inventory operation.
@Entity('inventory_operation_items')
@Index(['operationId'])
export class InventoryOperationItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'operation_id', type: 'uuid' })
  operationId: string;

  @Column({ name: 'product_id', type: 'uuid' })
  productId: string;

  @Column({ type: 'int' })
  quantity: number;
}
