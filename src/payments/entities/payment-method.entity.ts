import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/** Cómo se le dice al cliente dónde pagar, según el tipo de método manual. */
export type PaymentInstructions =
  | {
      type: 'bank';
      bankName: string;
      accountHolder?: string | null;
      accountNumber?: string | null;
      cardNumber?: string | null;
      note?: string | null;
    }
  | { type: 'qr'; imageUrl: string; note?: string | null }
  | { type: 'link'; url: string; note?: string | null }
  | {
      type: 'crypto';
      address: string;
      /**
       * Obligatoria: la misma dirección puede existir en varias cadenas y
       * mandar por la equivocada pierde los fondos.
       */
      network: string;
      asset?: string | null;
      /**
       * Algunas direcciones de exchange (XRP, XLM, ciertos USDT) lo exigen;
       * sin él el dinero se traba.
       */
      memo?: string | null;
      note?: string | null;
    };

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

  /**
   * Lo creó un admin desde el back-office, no una clase del código. Decide
   * quién se puede borrar y quién cae en la pasarela manual personalizada.
   */
  @Column({ name: 'is_custom', type: 'boolean', default: false })
  isCustom: boolean;

  /**
   * Lo que ve el cliente para pagar. Va aparte de `config` porque es contenido
   * de cara al cliente, no ajustes de operación. Sólo los métodos creados por
   * un admin lo llevan.
   */
  @Column({ type: 'jsonb', nullable: true })
  instructions: PaymentInstructions | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  // Borrado blando: los cobros ya hechos guardan su propia copia de las
  // instrucciones, así que el pedido viejo sigue contando cómo se pagó.
  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz' })
  deletedAt: Date | null;
}
