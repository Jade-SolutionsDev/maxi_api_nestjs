import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

export enum ContactReplyChannel {
  EMAIL = 'email',
  WHATSAPP = 'whatsapp',
  TELEFONO = 'telefono',
  PLATAFORMA = 'plataforma',
  NOTA = 'nota',
}

/**
 * Append-only reply log: one row per answer action on a message — an email or
 * WhatsApp opened from the admin (with the template/body used), a phone call,
 * a platform-sent email (once Resend lands), or an internal note. Never
 * soft-deleted: it is the audit trail of who answered what and how.
 */
@Entity('contact_replies')
@Index('IDX_contact_replies_message_id', ['messageId'])
export class ContactReply {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'message_id', type: 'uuid' })
  messageId: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({ type: 'enum', enum: ContactReplyChannel })
  channel: ContactReplyChannel;

  @Column({ name: 'template_id', type: 'uuid', nullable: true })
  templateId: string | null;

  @Column({ type: 'text', nullable: true })
  body: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
