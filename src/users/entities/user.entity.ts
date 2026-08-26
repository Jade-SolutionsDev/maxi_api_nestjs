import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum Role {
  SUPER_ADMIN = 'SUPER_ADMIN',
  ADMIN = 'ADMIN',
  GROCER = 'GROCER',
  KARDIST = 'KARDIST',
}

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({
    name: 'clerk_id',
    type: 'varchar',
    length: 255,
    nullable: true,
    unique: true,
  })
  clerkId: string | null;

  @Column({
    name: 'role',
    type: 'enum',
    enum: Role,
  })
  role: Role;

  @Column({ type: 'varchar', length: 255, nullable: true, unique: true })
  email: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  firstName: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  lastName: string | null;

  @Column({ type: 'varchar', length: 20, nullable: true })
  phone: string | null;

  @Column({ name: 'avatar_url', type: 'text', nullable: true })
  avatarUrl: string | null;

  @Column({
    name: 'business_name',
    type: 'varchar',
    length: 200,
    nullable: true,
  })
  businessName: string | null;

  @Column({ name: 'business_description', type: 'text', nullable: true })
  businessDescription: string | null;

  @Column({ name: 'business_logo_url', type: 'text', nullable: true })
  businessLogoUrl: string | null;

  @Column({
    name: 'clerk_org_id',
    type: 'varchar',
    length: 255,
    nullable: true,
    unique: true,
  })
  clerkOrgId: string | null;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  // Set the first time the account is activated (= approved). Distinguishes a
  // brand-new invited user awaiting approval (null) from one an admin disabled
  // after approving (non-null). See UsersService.update / user-response.dto.
  @Column({ name: 'approved_at', type: 'timestamptz', nullable: true })
  approvedAt: Date | null;

  @Column({ name: 'created_by', type: 'uuid', nullable: true })
  createdBy: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz' })
  deletedAt: Date | null;
}
