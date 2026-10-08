import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/** Shop-wide fulfillment rules. Singleton, same pattern as cms_site_settings. */
export interface FulfillmentSettingsData {
  /** Customers may collect their order at a storage's pickup address. */
  pickupEnabled: boolean;
  /**
   * Shown when the shop can fulfil nothing the customer could choose: pickup
   * off with no delivery option, or pickup on with no address configured
   * anywhere. Editable so ops can reword it without a deploy.
   */
  supportMessage: string;
  /**
   * Días hábiles que se tarda en tener un pedido listo para recoger. Hoy toda
   * la venta es recogida, así que sin esto el plazo casi no se usaría. Nulo =
   * sin compromiso.
   */
  pickupPromiseDays?: number | null;
  /**
   * Importe en USD a partir del cual el envío deja de cobrarse, comparado
   * contra el **subtotal de productos**: el envío no cuenta para ganárselo.
   *
   * Nulo = sin promoción, que es como está la tienda hoy. Se guarda en
   * céntimos enteros para no arrastrar los decimales del coma flotante en una
   * comparación de dinero: 50 USD son 5000.
   */
  freeDeliveryThresholdCents?: number | null;
}

@Entity('fulfillment_settings')
export class FulfillmentSettings {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'jsonb' })
  data: FulfillmentSettingsData;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
