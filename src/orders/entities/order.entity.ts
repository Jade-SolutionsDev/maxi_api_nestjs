import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Generated,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Client } from '../../clients/entities/client.entity';
import { OrderItem } from './order-item.entity';

export enum OrderStatus {
  PENDING = 'pending',
  CONFIRMED = 'confirmed',
  PROCESSING = 'processing',
  SHIPPED = 'shipped',
  DELIVERED = 'delivered',
  CANCELLED = 'cancelled',
}

export enum PaymentStatus {
  PENDING = 'pending',
  PAID = 'paid',
  FAILED = 'failed',
  REFUNDED = 'refunded',
}

// A storefront order. Prices/totals are snapshots taken at checkout (unlike the
// cart, which always recomputes). Stock is held via inventory_reservations:
// reserved at checkout, physically decremented on confirmation, released on
// cancellation.
@Entity('orders')
@Index(['clientId'])
export class Order {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // Human-facing number, e.g. ORD-20260001 (year + zero-padded seq). Filled in
  // right after insert (needs the generated seq), hence nullable in the schema.
  @Column({
    name: 'order_number',
    type: 'varchar',
    length: 20,
    unique: true,
    nullable: true,
  })
  orderNumber: string | null;

  @Column({ type: 'int' })
  @Generated('increment')
  seq: number;

  @Column({ name: 'client_id', type: 'uuid' })
  clientId: string;

  // Read-only join for denormalized client info in responses. No FK constraint
  // (same pattern as Product.category).
  @ManyToOne(() => Client, { createForeignKeyConstraints: false })
  @JoinColumn({ name: 'client_id' })
  client?: Client;

  @Column({ type: 'enum', enum: OrderStatus, default: OrderStatus.PENDING })
  status: OrderStatus;

  @Column({
    name: 'payment_status',
    type: 'enum',
    enum: PaymentStatus,
    default: PaymentStatus.PENDING,
  })
  paymentStatus: PaymentStatus;

  // Reference id at the (future) payment gateway; null for manual payments.
  @Column({ name: 'payment_ref', type: 'varchar', length: 255, nullable: true })
  paymentRef: string | null;

  @Column({ type: 'decimal', precision: 12, scale: 2 })
  subtotal: string;

  @Column({
    name: 'delivery_fee',
    type: 'decimal',
    precision: 12,
    scale: 2,
    default: 0,
  })
  deliveryFee: string;

  @Column({ type: 'decimal', precision: 12, scale: 2 })
  total: string;

  @Column({ name: 'delivery_municipality_id', type: 'uuid', nullable: true })
  deliveryMunicipalityId: string | null;

  @Column({ name: 'delivery_address', type: 'jsonb', nullable: true })
  deliveryAddress: Record<string, unknown> | null;

  @Column({ name: 'customer_notes', type: 'text', nullable: true })
  customerNotes: string | null;

  @OneToMany(() => OrderItem, (item) => item.order)
  items?: OrderItem[];

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at' })
  deletedAt: Date | null;
}
