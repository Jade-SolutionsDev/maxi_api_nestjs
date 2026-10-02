import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * Append-only record of every publication of a CmsPage: the exact title and
 * Markdown the store showed from `publishedAt` until the next version. Legal
 * texts need it — what the terms said when a customer bought is answered by
 * the latest version published before the order. Rows are never updated or
 * deleted, not even when their page is.
 */
@Entity('cms_page_versions')
@Index(['pageId', 'version'], { unique: true })
export class CmsPageVersion {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'page_id', type: 'uuid' })
  pageId: string;

  /** 1 for the first publication of the page, then +1 each time. */
  @Column({ type: 'int' })
  version: number;

  @Column({ type: 'varchar', length: 160 })
  title: string;

  @Column({ type: 'text' })
  content: string;

  @Column({ name: 'published_by_id', type: 'uuid', nullable: true })
  publishedById: string | null;

  /** Author as they read when publishing: survives renames and deletions. */
  @Column({ name: 'published_by_name', type: 'varchar', length: 160 })
  publishedByName: string;

  @CreateDateColumn({ name: 'published_at', type: 'timestamptz' })
  publishedAt: Date;
}
