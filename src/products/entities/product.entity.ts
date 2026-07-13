import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

// Global catalog: products are shared across the whole platform (no provider
// ownership). ponytail: no `departmentId` column — a product's department is the
// parent of its category, derived when needed; the department picker is a
// frontend cascade only.
@Entity('products')
@Index(['sku'], { unique: true })
@Index(['slug'], { unique: true })
export class Product {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'category_id', type: 'uuid' })
  categoryId: string;

  @Column({ type: 'varchar', length: 100 })
  sku: string;

  @Column({ type: 'varchar', length: 255 })
  name: string;

  @Column({ type: 'varchar', length: 255 })
  slug: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  // Nullable at the DB level so `synchronize` doesn't fail on pre-existing rows;
  // the DTO requires it on write.
  @Column({ name: 'image_url', type: 'text', nullable: true })
  imageUrl: string | null;

  // Commercial presentation, e.g. "Bolsa 1 kg", "Botella 900 ml".
  @Column({ type: 'varchar', length: 100, nullable: true })
  format: string | null;

  @Column({ name: 'expiry_date', type: 'date', nullable: true })
  expiryDate: string | null;

  // Unit of measure for the quantity: unidad, kg, g, L, ml, ...
  @Column({
    name: 'measure_unit',
    type: 'varchar',
    length: 50,
    default: 'unidad',
  })
  measureUnit: string;

  @Column({ name: 'base_price', type: 'decimal', precision: 12, scale: 2 })
  basePrice: string;

  // Percentage discount (0–100). decimal comes back as STRING.
  @Column({ type: 'decimal', precision: 5, scale: 2, default: 0 })
  discount: string;

  @Column({ name: 'is_featured', type: 'boolean', default: false })
  isFeatured: boolean;

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
