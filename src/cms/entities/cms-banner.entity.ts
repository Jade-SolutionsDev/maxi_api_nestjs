import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * One responsive image variant of a hero slide. `width`/`height` are the
 * intrinsic pixel dimensions — the storefront needs them to build srcsets
 * (next/image getImageProps), so they are required and validated > 0.
 */
export interface BannerAsset {
  src: string;
  width: number;
  height: number;
}

/** Home hero slide with art-directed desktop/tablet/mobile variants. */
@Entity('cms_banners')
export class CmsBanner {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 160 })
  alt: string;

  @Column({ type: 'jsonb' })
  desktop: BannerAsset;

  @Column({ type: 'jsonb' })
  tablet: BannerAsset;

  @Column({ type: 'jsonb' })
  mobile: BannerAsset;

  @Column({ name: 'sort_order', type: 'int', default: 0 })
  sortOrder: number;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz' })
  deletedAt: Date | null;
}
