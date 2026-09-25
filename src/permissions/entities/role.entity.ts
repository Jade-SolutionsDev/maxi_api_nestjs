import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * A managed (custom) role — distinct from the `Role` enum on the User entity.
 * System roles (SUPER_ADMIN/ADMIN) live on `users.role` and bypass permission
 * checks; these DB rows carry granular module×action grants for everyone else.
 */
@Entity('roles')
export class ManagedRole {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 100 })
  name: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  // Non-null only on the seeded base roles that replace the old hard-coded enum
  // starter templates (historical keys, e.g. 'GROCER'). Lets the seeder find
  // them across renames and lets user-creation auto-assign the matching base
  // role. Partial-unique in the DB (see RbacManagedCatalog migration).
  @Column({ name: 'system_key', type: 'varchar', length: 50, nullable: true })
  systemKey: string | null;

  @Column({ name: 'is_system', type: 'boolean', default: false })
  isSystem: boolean;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @Column({ name: 'created_by', type: 'uuid', nullable: true })
  createdBy: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz' })
  deletedAt: Date | null;
}
