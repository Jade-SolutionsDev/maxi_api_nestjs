import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum ComplaintStatus {
  ABIERTA = 'abierta',
  EN_GESTION = 'en_gestion',
  RESUELTA = 'resuelta',
}

/**
 * Una queja de un cliente, registrada por el Call Center.
 *
 * El motivo no es un enumerado: apunta a una fila de `nomenclators` de la
 * categoría `complaint-motive`, que el administrador edita desde el panel. Sin
 * motivos tipificados no se pueden agrupar en un informe, y fijarlos en código
 * obligaría a desplegar para añadir uno (MxH-0064).
 *
 * Referencias por uuid pelado, sin relaciones de TypeORM: convención de la
 * casa.
 */
@Entity('complaints')
@Index('IDX_complaints_status', ['status'])
@Index('IDX_complaints_created_at', ['createdAt'])
@Index('IDX_complaints_motive_id', ['motiveId'])
@Index('IDX_complaints_client_id', ['clientId'])
@Index('IDX_complaints_order_id', ['orderId'])
export class Complaint {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'client_id', type: 'uuid' })
  clientId: string;

  /** El pedido del que se queja, si la queja viene de uno. */
  @Column({ name: 'order_id', type: 'uuid', nullable: true })
  orderId: string | null;

  @Column({ name: 'motive_id', type: 'uuid' })
  motiveId: string;

  @Column({ type: 'text' })
  description: string;

  @Column({
    type: 'enum',
    enum: ComplaintStatus,
    default: ComplaintStatus.ABIERTA,
  })
  status: ComplaintStatus;

  /** Quién la atiende. Vacío mientras nadie la ha cogido. */
  @Column({ name: 'assigned_user_id', type: 'uuid', nullable: true })
  assignedUserId: string | null;

  /** Quién la registró. No cambia nunca. */
  @Column({ name: 'created_by_user_id', type: 'uuid' })
  createdByUserId: string;

  /**
   * Cómo se resolvió. Se exige al cerrarla: una queja resuelta sin explicación
   * no sirve para el informe ni para el cliente que vuelve a llamar.
   */
  @Column({ type: 'text', nullable: true })
  resolution: string | null;

  @Column({ name: 'resolved_at', type: 'timestamptz', nullable: true })
  resolvedAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at' })
  deletedAt: Date | null;
}
