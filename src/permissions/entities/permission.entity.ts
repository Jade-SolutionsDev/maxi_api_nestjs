import { Column, Entity, PrimaryGeneratedColumn, Unique } from 'typeorm';

// The unique pair is enforced in the DB by the RbacManagedCatalog migration
// (synchronize is off); declared here so the entity documents the invariant.
@Entity('permissions')
@Unique(['module', 'action'])
export class Permission {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 50 })
  module: string;

  @Column({ type: 'varchar', length: 50 })
  action: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;
}
