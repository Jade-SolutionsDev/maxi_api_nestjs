import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum ReservationStatus {
  RESERVED = 'reserved',
  CONFIRMED = 'confirmed',
  CANCELLED = 'cancelled',
  /**
   * Liberada porque nadie pagó a tiempo, no porque alguien decidiera cancelar.
   *
   * Se mide distinto: las canceladas dicen algo del cliente o del almacén, las
   * caducadas dicen cuánto stock se está reteniendo por pedidos que nunca se
   * pagan — y ese número es el que decide si el plazo de pago está bien puesto.
   */
  EXPIRED = 'expired',
}

// Stock held for a pending order, per (location, product) allocation. While
// status=reserved the quantity counts against inventory.reservedQuantity;
// confirming decrements physical stock, cancelling releases the hold.
@Entity('inventory_reservations')
@Index(['orderId'])
export class InventoryReservation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'order_id', type: 'uuid' })
  orderId: string;

  @Column({ name: 'location_id', type: 'uuid' })
  locationId: string;

  @Column({ name: 'product_id', type: 'uuid' })
  productId: string;

  @Column({ type: 'int' })
  quantity: number;

  @Column({
    type: 'enum',
    enum: ReservationStatus,
    default: ReservationStatus.RESERVED,
  })
  status: ReservationStatus;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
