import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/** Known nomenclator categories. Extend here when a new catalog appears. */
export const NOMENCLATOR_CATEGORIES = ['contact-motive'] as const;
export type NomenclatorCategory = (typeof NOMENCLATOR_CATEGORIES)[number];

/**
 * Generic option catalog: each row is one selectable option of a `category`
 * (contact motives today, any future enumeration tomorrow). `code` is the
 * stable machine name, unique per category, derived from the label.
 */
@Entity('nomenclators')
@Index('IDX_nomenclators_category_code', ['category', 'code'], { unique: true })
@Index('IDX_nomenclators_category', ['category'])
export class Nomenclator {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 60 })
  category: string;

  @Column({ type: 'varchar', length: 120 })
  code: string;

  @Column({ type: 'varchar', length: 120 })
  label: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ name: 'sort_order', type: 'int', default: 0 })
  sortOrder: number;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at' })
  deletedAt: Date | null;
}
