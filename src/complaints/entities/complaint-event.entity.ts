import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { ComplaintStatus } from './complaint.entity';

export enum ComplaintEventKind {
  REGISTRADA = 'registrada',
  ESTADO = 'estado',
  ASIGNADA = 'asignada',
  EDITADA = 'editada',
  NOTA = 'nota',
}

/**
 * El historial de una queja: una fila por cada cosa que le pasó, con quién la
 * hizo y cuándo.
 *
 * Solo se añade, nunca se borra ni se edita —tampoco en blando—: es la prueba
 * de quién cerró qué, que es justo lo que se consulta cuando un cliente
 * reclama que su queja «se resolvió» sin que nadie lo llamara.
 */
@Entity('complaint_events')
@Index('IDX_complaint_events_complaint_id', ['complaintId'])
export class ComplaintEvent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'complaint_id', type: 'uuid' })
  complaintId: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({ type: 'enum', enum: ComplaintEventKind })
  kind: ComplaintEventKind;

  @Column({ name: 'from_status', type: 'varchar', length: 20, nullable: true })
  fromStatus: ComplaintStatus | null;

  @Column({ name: 'to_status', type: 'varchar', length: 20, nullable: true })
  toStatus: ComplaintStatus | null;

  @Column({ type: 'text', nullable: true })
  note: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
