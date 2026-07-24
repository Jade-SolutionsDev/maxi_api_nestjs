import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Product } from '../../products/entities/product.entity';
import { Order } from './order.entity';

// A line of an order. Name and prices are snapshots from checkout time — later
// catalog edits never change what the customer agreed to pay.
@Entity('order_items')
@Index(['orderId'])
export class OrderItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'order_id', type: 'uuid' })
  orderId: string;

  @ManyToOne(() => Order, (order) => order.items, {
    createForeignKeyConstraints: false,
  })
  @JoinColumn({ name: 'order_id' })
  order?: Order;

  @Column({ name: 'product_id', type: 'uuid' })
  productId: string;

  // Read-only join for live presentation data (image); withDeleted lookups keep
  // lines renderable after a product is removed from the catalog.
  @ManyToOne(() => Product, { createForeignKeyConstraints: false })
  @JoinColumn({ name: 'product_id' })
  product?: Product;

  @Column({ name: 'product_name_snapshot', type: 'varchar', length: 255 })
  productNameSnapshot: string;

  @Column({ name: 'unit_price', type: 'decimal', precision: 12, scale: 2 })
  unitPrice: string;

  @Column({ type: 'int' })
  quantity: number;

  @Column({ name: 'line_total', type: 'decimal', precision: 12, scale: 2 })
  lineTotal: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
