import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Pre-elaborated answer ("draft") the support team picks when replying.
 * Optionally linked to a motive so the admin can surface the relevant drafts
 * first; the body is plain text handed to mailto/WhatsApp links today and to
 * the platform email sender once Resend is integrated.
 */
@Entity('contact_reply_templates')
export class ContactReplyTemplate {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 120 })
  title: string;

  @Column({ type: 'text' })
  body: string;

  @Column({ name: 'motive_id', type: 'uuid', nullable: true })
  motiveId: string | null;

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
