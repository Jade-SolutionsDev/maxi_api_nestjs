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

/**
 * Why an order was cancelled. Null for an ordinary customer/admin cancellation;
 * the two values below are set by the expiry sweep and by a payment that
 * arrived after it (see OrderExpiryService).
 */
export enum CancellationReason {
  /** Expired unpaid: the hold was released and the order closed. */
  PAYMENT_NOT_RECEIVED = 'payment_not_received',
  /**
   * Paid after expiring, but the stock was gone by then. Money is in, goods
   * cannot be served: administration must contact the customer and refund.
   */
  PAID_AFTER_EXPIRY_OUT_OF_STOCK = 'paid_after_expiry_out_of_stock',
}

/** How the customer gets the order. */
export enum FulfillmentType {
  DELIVERY = 'delivery',
  PICKUP = 'pickup',
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

  @Column({
    name: 'fulfillment_type',
    type: 'varchar',
    length: 10,
    default: FulfillmentType.DELIVERY,
  })
  fulfillmentType: FulfillmentType;

  // Snapshots, not references: the option can be renamed or removed later, and
  // the order must still say what the customer actually chose and paid for.
  @Column({ name: 'delivery_option_id', type: 'uuid', nullable: true })
  deliveryOptionId: string | null;

  @Column({
    name: 'delivery_option_label',
    type: 'varchar',
    length: 100,
    nullable: true,
  })
  deliveryOptionLabel: string | null;

  // Which storage the customer collects from — also the storage the stock is
  // held in, so the goods are on the right shelf when they arrive.
  @Column({ name: 'pickup_location_id', type: 'uuid', nullable: true })
  pickupLocationId: string | null;

  @Column({ name: 'pickup_address_id', type: 'uuid', nullable: true })
  pickupAddressId: string | null;

  @Column({ name: 'pickup_address_snapshot', type: 'jsonb', nullable: true })
  pickupAddressSnapshot: Record<string, unknown> | null;

  @Column({ name: 'delivery_municipality_id', type: 'uuid', nullable: true })
  deliveryMunicipalityId: string | null;

  @Column({ name: 'delivery_address', type: 'jsonb', nullable: true })
  deliveryAddress: Record<string, unknown> | null;

  @Column({ name: 'customer_notes', type: 'text', nullable: true })
  customerNotes: string | null;

  // Only meaningful while status = cancelled. varchar rather than a pg enum so
  // a new reason never needs a migration on a column that is purely narrative.
  @Column({
    name: 'cancellation_reason',
    type: 'varchar',
    length: 40,
    nullable: true,
  })
  cancellationReason: CancellationReason | null;

  @OneToMany(() => OrderItem, (item) => item.order)
  items?: OrderItem[];

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at' })
  deletedAt: Date | null;
}
