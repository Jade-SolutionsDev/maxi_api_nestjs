import {
  Check,
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { CmsBannerTargetType } from '../cms-banner.types';

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
@Check(
  'CK_cms_banners_target_pair',
  '("target_type" IS NULL) = ("target_id" IS NULL)',
)
@Check(
  'CK_cms_banners_target_type',
  `"target_type" IS NULL OR "target_type" IN ('department', 'category', 'product')`,
)
@Index('IDX_cms_banners_target', ['targetType', 'targetId'])
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

  @Column({ name: 'target_type', type: 'varchar', length: 20, nullable: true })
  targetType: CmsBannerTargetType | null;

  @Column({ name: 'target_id', type: 'uuid', nullable: true })
  targetId: string | null;

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
