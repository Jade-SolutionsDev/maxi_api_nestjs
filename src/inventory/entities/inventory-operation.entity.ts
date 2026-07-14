import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

export enum OperationType {
  IN = 'IN', // Entrada — add stock (purchase, production, return)
  OUT = 'OUT', // Salida — remove stock (sale, consumption, loss)
  TRANSFER = 'TRANSFER', // Transferencia — move stock to another storage
}

// Audit record of a stock movement over a storage. Each operation has one or
// more items (products + quantities). Immutable once created.
@Entity('inventory_operations')
@Index(['locationId'])
export class InventoryOperation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 20 })
  type: OperationType;

  // Source storage the operation acts on.
  @Column({ name: 'location_id', type: 'uuid' })
  locationId: string;

  // Destination storage for TRANSFER operations; null otherwise.
  @Column({ name: 'target_location_id', type: 'uuid', nullable: true })
  targetLocationId: string | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  note: string | null;

  @Column({ name: 'created_by', type: 'uuid' })
  createdBy: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
