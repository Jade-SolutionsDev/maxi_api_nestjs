import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { HomeLayout, HomeSnapshot } from '../cms-home.types';

/**
 * Singleton: the storefront home in two states. `draft` is what the editor is
 * changing (the banners of the draft are the live cms_banners rows);
 * `published` is the frozen copy the storefront serves. Publishing copies one
 * into the other — nothing an editor saves reaches the store before that.
 */
@Entity('cms_home')
export class CmsHome {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'jsonb' })
  draft: HomeLayout;

  @Column({ type: 'jsonb', nullable: true })
  published: HomeSnapshot | null;

  @Column({ name: 'draft_updated_at', type: 'timestamptz', nullable: true })
  draftUpdatedAt: Date | null;

  @Column({
    name: 'draft_updated_by',
    type: 'varchar',
    length: 160,
    nullable: true,
  })
  draftUpdatedBy: string | null;

  @Column({ name: 'published_at', type: 'timestamptz', nullable: true })
  publishedAt: Date | null;

  @Column({
    name: 'published_by',
    type: 'varchar',
    length: 160,
    nullable: true,
  })
  publishedBy: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
