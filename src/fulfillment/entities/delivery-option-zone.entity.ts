import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * Where a delivery option is offered. Same shape as stock_location_coverage: a
 * whole-province row has municipality_id NULL. Sibling table, bare-uuid FK, no
 * TypeORM relation — house convention. Replaced wholesale on update.
 */
@Entity('delivery_option_zones')
@Index(['optionId'])
export class DeliveryOptionZone {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'option_id', type: 'uuid' })
  optionId: string;

  @Column({ name: 'province_id', type: 'uuid' })
  provinceId: string;

  @Column({ name: 'municipality_id', type: 'uuid', nullable: true })
  municipalityId: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
