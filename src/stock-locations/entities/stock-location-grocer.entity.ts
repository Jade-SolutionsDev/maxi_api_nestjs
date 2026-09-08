import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

// Join row: a user assigned to a storage. Admins manage these; a non-admin may
// only access/edit storages they're assigned to (unless they hold the global
// stock-locations:view-all permission, which grants read-only visibility).
// "grocer" in the table/column names is historical — any user with a
// stock-locations grant can be assigned now.
@Entity('stock_location_grocers')
@Index(['locationId', 'grocerId'], { unique: true })
export class StockLocationGrocer {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'location_id', type: 'uuid' })
  locationId: string;

  @Column({ name: 'grocer_id', type: 'uuid' })
  grocerId: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
