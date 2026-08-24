import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

// A saved delivery address belonging to a storefront customer. Sibling table,
// bare-uuid FK, no TypeORM relation — same house convention as coverage and
// stock_location_pickup_addresses.
//
// The province is NOT stored: it is derived from the municipality through the
// geography catalog, so the two can never drift apart.
@Entity('client_addresses')
@Index(['clientId'])
export class ClientAddress {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'client_id', type: 'uuid' })
  clientId: string;

  // Short name the customer gives it: "Casa", "Trabajo".
  @Column({ type: 'varchar', length: 100, nullable: true })
  label: string | null;

  // Street and number, as written by the customer.
  @Column({ type: 'varchar', length: 300 })
  street: string;

  @Column({
    name: 'between_streets',
    type: 'varchar',
    length: 200,
    nullable: true,
  })
  betweenStreets: string | null;

  // Free-text landmark: "edificio azul, al lado de la panadería".
  @Column({ type: 'text', nullable: true })
  reference: string | null;

  // Drives the delivery zone of any order shipped here.
  @Column({ name: 'municipality_id', type: 'uuid' })
  municipalityId: string;

  // Optional: when empty, the client's own phone is the one to call.
  @Column({ name: 'contact_phone', type: 'varchar', length: 20, nullable: true })
  contactPhone: string | null;

  // At most one true per client among the non-deleted rows. Enforced in the
  // service, inside a transaction — not by a partial index, to keep the schema
  // portable under `synchronize`.
  @Column({ name: 'is_default', type: 'boolean', default: false })
  isDefault: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at' })
  deletedAt: Date | null;
}
