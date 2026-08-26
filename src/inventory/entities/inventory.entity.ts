import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

// Current physical stock of a product at a storage. One row per (location, product).
// `quantity` is physical stock; `reservedQuantity` is held by pending orders
// (inventory_reservations rows with status=reserved). available = quantity -
// reservedQuantity everywhere the storefront is concerned.
@Entity('inventory')
@Index(['locationId', 'productId'], { unique: true })
export class Inventory {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'location_id', type: 'uuid' })
  locationId: string;

  @Column({ name: 'product_id', type: 'uuid' })
  productId: string;

  @Column({ type: 'int', default: 0 })
  quantity: number;

  @Column({ name: 'reserved_quantity', type: 'int', default: 0 })
  reservedQuantity: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
