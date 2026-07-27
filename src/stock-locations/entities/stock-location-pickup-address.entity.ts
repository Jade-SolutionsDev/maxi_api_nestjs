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

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
