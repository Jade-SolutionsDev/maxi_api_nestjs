import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { CmsPageVersion } from './cms-page-version.entity';

/**
 * What a text is for. A `page` is an info page (privacy policy, terms, about
 * us, contact intro…) the storefront renders at /paginas/[slug] or on its own
 * route; a `home-notice` is a temporary announcement shown on the home.
 */
export enum CmsPageKind {
  PAGE = 'page',
  HOME_NOTICE = 'home-notice',
}

/**
 * Editable Markdown text with a draft and a published copy. `title` and
 * `content` are the DRAFT — what the editor is working on, never shown by the
 * store. The store reads `publishedVersion`, frozen by CmsPagesService.publish
 * into the append-only cms_page_versions history. Slug, order, visibility and
 * the notice schedule are not drafted: they apply as soon as they are saved.
 */
@Entity('cms_pages')
@Index(['slug'], { unique: true })
export class CmsPage {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 20, default: CmsPageKind.PAGE })
  kind: CmsPageKind;

  @Column({ type: 'varchar', length: 120 })
  slug: string;

  @Column({ type: 'varchar', length: 160 })
  title: string;

  @Column({ type: 'text' })
  content: string;

  @Column({ name: 'sort_order', type: 'int', default: 0 })
  sortOrder: number;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  /** Home notices only: shown from this moment on (null = right away). */
  @Column({ name: 'starts_at', type: 'timestamptz', nullable: true })
  startsAt: Date | null;

  /** Home notices only: hidden from this moment on (null = until removed). */
  @Column({ name: 'ends_at', type: 'timestamptz', nullable: true })
  endsAt: Date | null;

  @Column({ name: 'draft_updated_at', type: 'timestamptz', nullable: true })
  draftUpdatedAt: Date | null;

  @Column({
    name: 'draft_updated_by',
    type: 'varchar',
    length: 160,
    nullable: true,
  })
  draftUpdatedBy: string | null;

  @Column({ name: 'published_version_id', type: 'uuid', nullable: true })
  publishedVersionId: string | null;

  @ManyToOne(() => CmsPageVersion, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'published_version_id' })
  publishedVersion?: CmsPageVersion | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz' })
  deletedAt: Date | null;
}
