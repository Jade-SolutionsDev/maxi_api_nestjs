import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

// Static reference data (Cuba). `province_id` is a bare uuid FK (validated in
// services), matching the house convention. No soft-delete.
@Entity('municipalities')
@Index(['code'], { unique: true })
@Index(['provinceId'])
export class Municipality {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'province_id', type: 'uuid' })
  provinceId: string;

  @Column({ type: 'varchar', length: 100 })
  name: string;

  @Column({ type: 'varchar', length: 10 })
  code: string;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
