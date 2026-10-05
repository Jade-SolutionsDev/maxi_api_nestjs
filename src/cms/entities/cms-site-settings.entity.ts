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
 * Una red social de la tienda: lo que se ve en el pie, en la página de contacto
 * y en el pie de los ocho correos.
 *
 * Es una lista y no un objeto con un campo por red porque mañana hay un TikTok
 * y eso no debería tocar ni el esquema ni el código. El `label` es lo que lee
 * una persona; el icono no se guarda: la tienda las pinta como texto a
 * propósito, porque un PNG en el pie de un correo es una imagen más de las que
 * el gestor bloquea, y entonces no queda ni el enlace.
 */
export interface SiteSocialLink {
  label: string;
  url: string;
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
  /** Vacío es válido: una tienda puede no tener redes. */
  social: SiteSocialLink[];
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

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
