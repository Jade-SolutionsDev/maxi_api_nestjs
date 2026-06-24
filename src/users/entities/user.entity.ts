import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';

export enum UserType {
  ADMIN = 'admin',
  PROVIDER = 'provider',
  STAFF = 'staff',
}

@Entity('users')
@Unique(['email'])
@Unique(['clerkId'])
@Unique(['clerkOrgId'])
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
    name: 'user_type',
    type: 'enum',
    enum: UserType,
  })
  userType: UserType;

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

  @Column({ name: 'created_by', type: 'uuid', nullable: true })
  createdBy: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at' })
  deletedAt: Date | null;
}
