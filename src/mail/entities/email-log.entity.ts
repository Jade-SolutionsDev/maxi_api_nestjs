import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

export enum EmailStatus {
  SENT = 'sent',
  FAILED = 'failed',
  /** No se intentó: no hay credenciales de correo configuradas. */
  SKIPPED = 'skipped',
}

/**
 * Qué correo se mandó, a quién y cuándo.
 *
 * No es telemetría: es la prueba. La política de custodia dice que a los 30
 * días el pedido deja de tener reposición y devolución, y eso solo se sostiene
 * si podemos demostrar que avisamos dos veces antes. Sin esta tabla, la
 * cláusula es palabra contra palabra.
 *
 * También sirve de candado: el recordatorio se manda una vez por pedido y
 * hito, mirando aquí y no la hora del reloj.
 */
@Entity('email_log')
@Index('IDX_email_log_order_template', ['orderId', 'template'])
@Index('IDX_email_log_created', ['createdAt'])
export class EmailLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Clave de la plantilla: `payment_received`, `pickup_reminder_15`… */
  @Column({ type: 'varchar', length: 60 })
  template: string;

  @Column({ name: 'to_address', type: 'varchar', length: 255 })
  toAddress: string;

  @Column({ type: 'varchar', length: 255 })
  subject: string;

  @Column({ name: 'order_id', type: 'uuid', nullable: true })
  orderId: string | null;

  @Column({ type: 'varchar', length: 20 })
  status: EmailStatus;

  /** Identificador que devuelve Resend, para rastrear el envío con ellos. */
  @Column({ name: 'provider_id', type: 'varchar', length: 255, nullable: true })
  providerId: string | null;

  @Column({ name: 'error_message', type: 'text', nullable: true })
  errorMessage: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
