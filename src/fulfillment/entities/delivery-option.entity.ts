import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * One way the shop delivers, as the admin defines it: "Mensajería La Habana",
 * "Entrega en 24h". The catalogue is deliberately empty at launch — delivery is
 * not operating yet — which is what leaves pickup as the only option.
 *
 * Zones live in delivery_option_zones; no zone rows means "available anywhere".
 */
@Entity('delivery_options')
export class DeliveryOption {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 100 })
  label: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  // What the customer pays for this option. Lands on orders.delivery_fee, which
  // was hardcoded to zero until now.
  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  fee: string;

  /**
   * Días hábiles que esta opción promete, contados desde el pago. Nulo = sin
   * compromiso publicado. Se cuenta de lunes a sábado, sin feriados.
   */
  @Column({ name: 'promise_days', type: 'int', nullable: true })
  promiseDays: number | null;

  /**
   * Subtotal de productos —en céntimos— a partir del cual esta forma de
   * entrega no se cobra. Nulo = sin promoción, que es como nacen todas.
   *
   * Por opción y no de toda la tienda: la promoción es del envío, así que vive
   * con el envío. Y así una Express puede regalarse a partir de 200 mientras
   * la normal lo hace a partir de 50.
   *
   * En céntimos enteros: comparar dólares en coma flotante deja sin promoción
   * a quien compra justo el importe.
   */
  @Column({
    name: 'free_delivery_threshold_cents',
    type: 'int',
    nullable: true,
  })
  freeDeliveryThresholdCents: number | null;

  @Column({ name: 'sort_order', type: 'int', default: 0 })
  sortOrder: number;

  // Off by default: offering a delivery method is a deliberate act.
  @Column({ type: 'boolean', default: false })
  enabled: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz' })
  deletedAt: Date | null;
}
