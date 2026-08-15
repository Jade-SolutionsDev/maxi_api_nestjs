import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/** Footer legal link pointing at a CmsPage slug (storefront /paginas/[slug]). */
export interface SiteLegalLink {
  label: string;
  slug: string;
}

/**
 * Site-wide editable settings consumed by the storefront layout. Payment
 * methods are a FIXED catalog of toggles — the storefront bundles the logos
 * and only shows the enabled ones; adding a new method is a code change on
 * both sides by design (logo quality + sizing stay controlled).
 */
export interface SiteSettingsData {
  footer: {
    blurb: string;
    copyright: string;
    legalLinks: SiteLegalLink[];
  };
  contact: {
    email: string;
    phone: string;
  };
  payments: {
    visa: boolean;
    mastercard: boolean;
    mibilletera: boolean;
  };
  services: {
    heading: string;
    subheading: string;
  };
}

/**
 * Singleton: exactly one row, upserted by CmsService.updateSettings and
 * seeded with DEFAULT_SITE_SETTINGS. No soft-delete — settings are never
 * deleted, only replaced.
 */
@Entity('cms_site_settings')
export class CmsSiteSettings {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'jsonb' })
  data: SiteSettingsData;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
