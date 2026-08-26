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
