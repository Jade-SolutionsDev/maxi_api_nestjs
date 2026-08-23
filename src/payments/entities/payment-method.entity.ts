import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Admin-facing catalog of payment platforms. One row per registered gateway,
 * upserted on boot from the code (so a new gateway shows up without a seed
 * script) — but only the *presentation* fields are refreshed there: `enabled`,
 * `label`, `description`, `sortOrder` and `config` belong to the admin once the
 * row exists. Credentials never live here; they stay in the environment.
 */
@Entity('payment_methods')
export class PaymentMethod {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Gateway key, e.g. "tropipay". Matches PaymentGateway.code. */
  @Column({ type: 'varchar', length: 32, unique: true })
  code: string;

  @Column({ type: 'varchar', length: 80 })
  label: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  /** Lucide icon name the storefront/admin render (kept in their allowlists). */
  @Column({ type: 'varchar', length: 40, nullable: true })
  icon: string | null;

  @Column({ name: 'sort_order', type: 'int', default: 0 })
  sortOrder: number;

  // Off by default: enabling a gateway is a deliberate admin act.
  @Column({ type: 'boolean', default: false })
  enabled: boolean;

  /** Non-secret per-method settings (currency, expiration days, ...). */
  @Column({ type: 'jsonb', nullable: true })
  config: Record<string, unknown> | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
