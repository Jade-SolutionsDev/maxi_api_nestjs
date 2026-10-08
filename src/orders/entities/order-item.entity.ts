import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Product } from '../../products/entities/product.entity';
import { Order } from './order.entity';

// A line of an order. Name and prices are snapshots from checkout time — later
// catalog edits never change what the customer agreed to pay.
@Entity('order_items')
@Index(['orderId'])
export class OrderItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'order_id', type: 'uuid' })
  orderId: string;

  @ManyToOne(() => Order, (order) => order.items, {
    createForeignKeyConstraints: false,
  })
  @JoinColumn({ name: 'order_id' })
  order?: Order;

  @Column({ name: 'product_id', type: 'uuid' })
  productId: string;

  // Read-only join for live presentation data (image); withDeleted lookups keep
  // lines renderable after a product is removed from the catalog.
  @ManyToOne(() => Product, { createForeignKeyConstraints: false })
  @JoinColumn({ name: 'product_id' })
  product?: Product;

  @Column({ name: 'product_name_snapshot', type: 'varchar', length: 255 })
  productNameSnapshot: string;

  /**
   * El precio de lista del producto el día de la compra, antes de la rebaja.
   *
   * `unitPrice` guarda lo que se cobró, que es el resultado; esto y `discount`
   * guardan **de dónde salió**. Sin ellos, dentro de un año no hay forma de
   * saber si una línea se vendió a 80 porque valía 80 o porque valía 100 con
   * un 20% de rebaja: el producto habrá cambiado de precio y el dato no se
   * recupera (MxH-0056).
   *
   * Nulo en las líneas anteriores al 8-oct-2026, y nulo a propósito: ese dato
   * no se registró y rellenarlo sería inventarlo.
   */
  @Column({
    name: 'list_price',
    type: 'decimal',
    precision: 12,
    scale: 2,
    nullable: true,
  })
  listPrice: string | null;

  /** El porcentaje de rebaja aplicado, congelado igual que el precio. */
  @Column({
    type: 'decimal',
    precision: 5,
    scale: 2,
    nullable: true,
  })
  discount: string | null;

  /** Lo que de verdad se cobró por unidad. */
  @Column({ name: 'unit_price', type: 'decimal', precision: 12, scale: 2 })
  unitPrice: string;

  @Column({ type: 'int' })
  quantity: number;

  @Column({ name: 'line_total', type: 'decimal', precision: 12, scale: 2 })
  lineTotal: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
