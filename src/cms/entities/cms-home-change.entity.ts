import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { CmsHomeChangeAction } from '../cms-home.types';

/**
 * Append-only log of every edit to the home: who, what and when. The author's
 * display name is copied at write time so the log still reads right after the
 * user is renamed or removed.
 */
@Entity('cms_home_changes')
@Index('IDX_cms_home_changes_created_at', ['createdAt'])
export class CmsHomeChange {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 30 })
  action: CmsHomeChangeAction;

  @Column({ type: 'varchar', length: 160, nullable: true })
  subject: string | null;

  @Column({ name: 'actor_id', type: 'uuid', nullable: true })
  actorId: string | null;

  @Column({ name: 'actor_name', type: 'varchar', length: 160 })
  actorName: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
