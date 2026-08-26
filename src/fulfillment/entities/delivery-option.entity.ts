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

  @Column({ name: 'sort_order', type: 'int', default: 0 })
  sortOrder: number;

  // Off by default: offering a delivery method is a deliberate act.
  @Column({ type: 'boolean', default: false })
  enabled: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at' })
  deletedAt: Date | null;
}
