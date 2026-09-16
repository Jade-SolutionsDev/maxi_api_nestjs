import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/** Quién provocó el cambio. */
export enum OrderEventActor {
  /** Una persona del back-office (usuario del admin). */
  ADMIN = 'admin',
  /** El cliente desde la tienda. */
  CLIENT = 'client',
  /** El propio sistema: caducidad, webhook de una pasarela. */
  SYSTEM = 'system',
}

/**
 * Qué pasó. Se guarda como varchar y no como enum de Postgres para que un
 * tipo nuevo nunca necesite migración: el historial es narrativo.
 */
export enum OrderEventKind {
  CREATED = 'created',
  STATUS_CHANGED = 'status_changed',
  PAYMENT_STATUS_CHANGED = 'payment_status_changed',
  PAYMENT_ATTEMPT = 'payment_attempt',
  PROOF_SUBMITTED = 'proof_submitted',
  REINSTATED = 'reinstated',
  EXPIRED = 'expired',
}

/**
 * Historial de un pedido: una fila por cada cosa que le pasó, con quién lo
 * hizo, cuándo, qué había antes y qué hay después. Es la base de cualquier
 * edición que se dé a la administración: sin rastro no hay permiso que valga.
 *
 * Nunca se actualiza ni se borra una fila; si algo se deshace, se añade otra.
 */
@Entity('order_events')
@Index('IDX_order_events_order_created', ['orderId', 'createdAt'])
export class OrderEvent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'order_id', type: 'uuid' })
  orderId: string;

  @Column({ type: 'varchar', length: 40 })
  kind: OrderEventKind;

  @Column({ name: 'actor_kind', type: 'varchar', length: 20 })
  actorKind: OrderEventActor;

  /** Usuario del admin que actuó; null si fue el cliente o el sistema. */
  @Column({ name: 'actor_user_id', type: 'uuid', nullable: true })
  actorUserId: string | null;

  /** Cliente que actuó; null si fue un admin o el sistema. */
  @Column({ name: 'actor_client_id', type: 'uuid', nullable: true })
  actorClientId: string | null;

  /** Campo afectado cuando aplica: `status`, `paymentStatus`. */
  @Column({ type: 'varchar', length: 60, nullable: true })
  field: string | null;

  @Column({
    name: 'previous_value',
    type: 'varchar',
    length: 120,
    nullable: true,
  })
  previousValue: string | null;

  @Column({ name: 'next_value', type: 'varchar', length: 120, nullable: true })
  nextValue: string | null;

  /** Motivo escrito por quien actuó, o narrativa del sistema. */
  @Column({ type: 'text', nullable: true })
  reason: string | null;

  /** Detalle extra: proveedor de pago, referencia, si hubo captura… */
  @Column({ type: 'jsonb', nullable: true })
  meta: Record<string, unknown> | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
