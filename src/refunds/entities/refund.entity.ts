import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * En qué punto está la devolución del dinero.
 *
 * `requested` no ha movido un centavo: es el compromiso de devolver. El pedido
 * solo pasa a `refunded` cuando alguien confirma que el dinero salió de
 * verdad, que es la regla que pidió el cliente — hasta entonces sigue `paid`.
 */
export enum RefundStatus {
  REQUESTED = 'requested',
  COMPLETED = 'completed',
  REJECTED = 'rejected',
}

/**
 * Cómo se devolvió. Hoy siempre a mano: Tropipay exige un código SMS de doble
 * factor para reembolsar en producción, así que no hay API que llamar
 * (MxH-0048). El valor existe para que el dato no mienta el día que la haya.
 */
export enum RefundMethod {
  MANUAL = 'manual',
  GATEWAY = 'gateway',
}

/** Quién lo puso en marcha: una persona del back-office o el propio sistema. */
export enum RefundOrigin {
  ADMIN = 'admin',
  SYSTEM = 'system',
}

/**
 * Una devolución de dinero sobre un pedido cobrado.
 *
 * Hay varias filas por pedido a propósito: una devolución parcial («se entrega
 * lo disponible y se devuelve el resto») deja el pedido cobrado por el resto,
 * y puede haber otra después. El estado de pago del pedido no se toca hasta
 * que lo devuelto iguala lo cobrado.
 *
 * Nada se borra: un reembolso que no procede se rechaza con su motivo.
 */
@Entity('refunds')
@Index('IDX_refunds_order', ['orderId'])
@Index('IDX_refunds_status_requested', ['status', 'requestedAt'])
export class Refund {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'order_id', type: 'uuid' })
  orderId: string;

  /** Importe a devolver, en la moneda del pedido (USD). Nunca mayor que lo pendiente. */
  @Column({ type: 'decimal', precision: 12, scale: 2 })
  amount: string;

  @Column({ type: 'varchar', length: 10, default: 'USD' })
  currency: string;

  @Column({ type: 'varchar', length: 20, default: RefundStatus.REQUESTED })
  status: RefundStatus;

  @Column({ type: 'varchar', length: 20, default: RefundMethod.MANUAL })
  method: RefundMethod;

  @Column({ type: 'varchar', length: 20, default: RefundOrigin.ADMIN })
  origin: RefundOrigin;

  /** Por qué se devuelve. Obligatorio: es dinero y tiene que quedar dicho. */
  @Column({ type: 'text' })
  reason: string;

  /**
   * A dónde se envió: dirección USDT en red BEP20, o la referencia de la
   * pasarela. Se pide al confirmar, no al solicitar — al solicitar todavía no
   * se la hemos pedido al cliente.
   */
  @Column({ type: 'varchar', length: 255, nullable: true })
  destination: string | null;

  /** Identificador del movimiento: hash de la transacción o referencia interna. */
  @Column({
    name: 'provider_ref',
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  providerRef: string | null;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @Column({ name: 'requested_by', type: 'uuid', nullable: true })
  requestedBy: string | null;

  @Column({ name: 'requested_at', type: 'timestamptz' })
  requestedAt: Date;

  @Column({ name: 'completed_by', type: 'uuid', nullable: true })
  completedBy: string | null;

  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  completedAt: Date | null;

  @Column({ name: 'rejected_by', type: 'uuid', nullable: true })
  rejectedBy: string | null;

  @Column({ name: 'rejected_at', type: 'timestamptz', nullable: true })
  rejectedAt: Date | null;

  @Column({ name: 'rejection_reason', type: 'text', nullable: true })
  rejectionReason: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
