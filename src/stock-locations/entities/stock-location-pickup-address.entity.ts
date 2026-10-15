import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

// A physical pickup point for a storage (label + free-text address). Sibling
// join table, bare-uuid FK, no TypeORM relation — same house convention as
// coverage/grocers. Replaced wholesale on update.
@Entity('stock_location_pickup_addresses')
export class StockLocationPickupAddress {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'location_id', type: 'uuid' })
  locationId: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  label: string | null;

  @Column({ type: 'varchar', length: 300 })
  address: string;

  /**
   * Cuándo se puede pasar a recoger, tal cual se le dice al cliente: «9:00 am a
   * 3:00 pm, de lunes a viernes». Nulo = sin horario publicado, y entonces no se
   * enseña nada en vez de un hueco (MxH-0160).
   */
  @Column({ type: 'varchar', length: 160, nullable: true })
  hours: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
