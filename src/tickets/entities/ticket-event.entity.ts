import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { TicketStatus } from './ticket.entity';

export enum TicketEventKind {
  ABIERTO = 'abierto',
  ESTADO = 'estado',
  ASIGNADO = 'asignado',
  EDITADO = 'editado',
  COMENTARIO = 'comentario',
}

/**
 * El historial de un ticket: una fila por cada cosa que le pasó, con quién la
 * hizo y cuándo. Es a la vez el registro de cambios de estado que pide la
 * tarjeta y los comentarios del ticket, porque son lo mismo contado dos veces:
 * una conversación con las fechas de los cambios intercaladas, que es como se
 * lee una incidencia.
 *
 * Solo se añade, nunca se borra ni se edita —tampoco en blando—: es la prueba
 * de quién dio por bueno qué.
 */
@Entity('ticket_events')
@Index('IDX_ticket_events_ticket_id', ['ticketId'])
export class TicketEvent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'ticket_id', type: 'uuid' })
  ticketId: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({ type: 'enum', enum: TicketEventKind })
  kind: TicketEventKind;

  @Column({ name: 'from_status', type: 'varchar', length: 20, nullable: true })
  fromStatus: TicketStatus | null;

  @Column({ name: 'to_status', type: 'varchar', length: 20, nullable: true })
  toStatus: TicketStatus | null;

  @Column({ type: 'text', nullable: true })
  note: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
