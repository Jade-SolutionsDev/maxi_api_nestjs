import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum CoverageType {
  PROVINCE = 'province',
  MUNICIPALITY = 'municipality',
}

// One coverage row = "this storage serves this province (whole) or this specific
// municipality". A whole-province row has municipality_id NULL.
@Entity('stock_location_coverage')
@Index(['locationId', 'provinceId', 'municipalityId'], { unique: true })
export class StockLocationCoverage {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'location_id', type: 'uuid' })
  locationId: string;

  @Column({ name: 'coverage_type', type: 'varchar', length: 20 })
  coverageType: CoverageType;

  @Column({ name: 'province_id', type: 'uuid' })
  provinceId: string;

  @Column({ name: 'municipality_id', type: 'uuid', nullable: true })
  municipalityId: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
