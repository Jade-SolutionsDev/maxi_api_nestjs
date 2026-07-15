import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

// Join row: a GROCER user assigned to a storage. Admins manage these; a grocer
// may only access/edit storages they're assigned to.
@Entity('stock_location_grocers')
@Index(['locationId', 'grocerId'], { unique: true })
export class StockLocationGrocer {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'location_id', type: 'uuid' })
  locationId: string;

  @Column({ name: 'grocer_id', type: 'uuid' })
  grocerId: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
