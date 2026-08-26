import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Product } from '../../products/entities/product.entity';

// The cart is just its rows: one per (client, product). No cart header entity —
// prices are never stored; every read recomputes them from the live product.
// Hard-deleted (no soft-delete): cart rows are ephemeral state, not records.
@Entity('cart_items')
@Index(['clientId', 'productId'], { unique: true })
export class CartItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'client_id', type: 'uuid' })
  clientId: string;

  @Column({ name: 'product_id', type: 'uuid' })
  productId: string;

  // Read-only join for cart reads. No FK constraint (same pattern as
  // Product.category); withDeleted lookups let removed products surface as
  // unavailable lines instead of vanishing silently.
  @ManyToOne(() => Product, { createForeignKeyConstraints: false })
  @JoinColumn({ name: 'product_id' })
  product?: Product;

  @Column({ type: 'int' })
  quantity: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
