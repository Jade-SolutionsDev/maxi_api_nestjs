import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

// Canonical charge vocabulary. Every gateway maps its own statuses into this
// set, so orders, the admin and the storefront read one language.
export enum ChargeStatus {
  PENDING = 'PENDING',
  REQUIRES_ACTION = 'REQUIRES_ACTION',
  PROCESSING = 'PROCESSING',
  SUCCEEDED = 'SUCCEEDED',
  FAILED = 'FAILED',
  EXPIRED = 'EXPIRED',
  CANCELLED = 'CANCELLED',
}

export const TERMINAL_CHARGE_STATUSES = [
  ChargeStatus.SUCCEEDED,
  ChargeStatus.FAILED,
  ChargeStatus.EXPIRED,
  ChargeStatus.CANCELLED,
];

// One payment attempt at one gateway. An order can accumulate several (an
// expired/failed attempt requires a NEW charge with a NEW idempotency key —
// a rule both Mi Billetera and Tropipay share), so charges are rows, not order
// columns, and the customer may even retry with a different method.
// `lastPayload` keeps the most recent full gateway/webhook body (persist
// payloads for support, audit and reconciliation).
@Entity('payment_charges')
@Index(['orderId'])
export class PaymentCharge {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'order_id', type: 'uuid' })
  orderId: string;

  // Gateway that owns this attempt (payment_methods.code).
  @Column({ type: 'varchar', length: 32 })
  provider: string;

  // Gateway identifier — unique lookup key for webhooks and polling.
  @Column({ type: 'varchar', length: 64, unique: true })
  reference: string;

  @Column({ name: 'idempotency_key', type: 'varchar', length: 128 })
  idempotencyKey: string;

  @Column({ type: 'varchar', length: 32 })
  status: ChargeStatus;

  // Gateway normalizes crypto amounts to 8 decimals.
  @Column({ type: 'decimal', precision: 20, scale: 8 })
  amount: string;

  @Column({
    name: 'fee_amount',
    type: 'decimal',
    precision: 20,
    scale: 8,
    nullable: true,
  })
  feeAmount: string | null;

  @Column({
    name: 'settlement_amount',
    type: 'decimal',
    precision: 20,
    scale: 8,
    nullable: true,
  })
  settlementAmount: string | null;

  @Column({ type: 'varchar', length: 10 })
  currency: string;

  // The customer-facing deposit instructions (deposit_address, amount, token,
  // blockchain, expires_at, internal_reference) — always rendered from here,
  // never hardcoded (the gateway decides the network).
  @Column({ name: 'action_payload', type: 'jsonb', nullable: true })
  actionPayload: Record<string, unknown> | null;

  // Hosted checkout the customer must be sent to (redirect gateways).
  @Column({ name: 'redirect_url', type: 'text', nullable: true })
  redirectUrl: string | null;

  // Latest full gateway response or webhook event body.
  @Column({ name: 'last_payload', type: 'jsonb', nullable: true })
  lastPayload: Record<string, unknown> | null;

  @Column({ name: 'error_message', type: 'text', nullable: true })
  errorMessage: string | null;

  @Column({ name: 'expires_at', type: 'timestamptz', nullable: true })
  expiresAt: Date | null;

  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  completedAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
