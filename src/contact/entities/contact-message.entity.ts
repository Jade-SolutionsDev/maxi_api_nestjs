import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum ContactMessageStatus {
  NUEVO = 'nuevo',
  EN_PROCESO = 'en_proceso',
  RESPONDIDO = 'respondido',
  CERRADO = 'cerrado',
}

/**
 * A customer support inquiry from the storefront contact form. Identity is a
 * SNAPSHOT taken at submit time: signed-in senders copy their Client row
 * (client_id links back), anonymous senders type it in — either way the
 * message stays self-contained if the account later changes or is deleted.
 * Bare-uuid references, no TypeORM relations (house convention).
 */
@Entity('contact_messages')
@Index('IDX_contact_messages_status', ['status'])
@Index('IDX_contact_messages_created_at', ['createdAt'])
@Index('IDX_contact_messages_motive_id', ['motiveId'])
@Index('IDX_contact_messages_client_id', ['clientId'])
export class ContactMessage {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'motive_id', type: 'uuid' })
  motiveId: string;

  @Column({ name: 'client_id', type: 'uuid', nullable: true })
  clientId: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  name: string | null;

  @Column({ name: 'last_name', type: 'varchar', length: 100, nullable: true })
  lastName: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  email: string | null;

  @Column({ type: 'varchar', length: 40, nullable: true })
  phone: string | null;

  @Column({ type: 'text' })
  message: string;

  @Column({
    type: 'enum',
    enum: ContactMessageStatus,
    default: ContactMessageStatus.NUEVO,
  })
  status: ContactMessageStatus;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at' })
  deletedAt: Date | null;
}
