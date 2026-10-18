import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { BannerAsset } from './cms-banner.entity';

/**
 * El aviso emergente de la tienda. `MxH-0037`.
 *
 * Una ventana que se abre sobre el catálogo durante las fechas que le pongan:
 * anuncia, y **no aplica descuentos ni regala productos**. Eso último lo pedía
 * la imagen de la tarjeta y se dejó fuera a propósito: un cupón toca carrito,
 * precios, existencias y devoluciones, y depende de `P-114`, sin decidir.
 *
 * **Tabla propia y no un `kind` más de `cms_pages`**, aunque el ciclo de vida
 * se copie de allí: una página del CMS es título y Markdown, y esto lleva
 * imagen en tres medidas y un botón. Meterlo en `content` habría sido guardar
 * JSON dentro de un campo de texto.
 */
@Entity('cms_popups')
export class CmsPopup {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 160 })
  title: string;

  @Column({ type: 'text' })
  body: string;

  /** Texto del botón. Sin él, el aviso solo informa y se cierra. */
  @Column({ name: 'button_label', type: 'varchar', length: 60, nullable: true })
  buttonLabel: string | null;

  /** A dónde lleva el botón. Ruta de la tienda o dirección completa. */
  @Column({ name: 'button_href', type: 'varchar', length: 300, nullable: true })
  buttonHref: string | null;

  /**
   * Las tres medidas, igual que un banner de la portada: la tienda las usa
   * para no servirle a un teléfono la imagen del escritorio. Opcionales —un
   * aviso puede ser solo texto— pero o están las tres o no está ninguna.
   */
  @Column({ type: 'jsonb', nullable: true })
  desktop: BannerAsset | null;

  @Column({ type: 'jsonb', nullable: true })
  tablet: BannerAsset | null;

  @Column({ type: 'jsonb', nullable: true })
  mobile: BannerAsset | null;

  /** Desde cuándo se ve. Nulo: desde que se publica. */
  @Column({ name: 'starts_at', type: 'timestamptz', nullable: true })
  startsAt: Date | null;

  /** Hasta cuándo. Nulo: hasta que lo apaguen. Con fecha **se retira solo**. */
  @Column({ name: 'ends_at', type: 'timestamptz', nullable: true })
  endsAt: Date | null;

  /**
   * Cuántas horas tarda en volver a salirle a quien lo cerró. Nulo: no vuelve
   * hasta que el aviso cambie. Lo guarda el navegador de cada visitante, así
   * que es una preferencia, no una garantía.
   */
  @Column({ name: 'repeat_after_hours', type: 'int', nullable: true })
  repeatAfterHours: number | null;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  /**
   * Cuándo se publicó. **Nulo es un borrador**, y un borrador no sale de la
   * administración ni aunque esté activo y en fecha.
   */
  @Column({ name: 'published_at', type: 'timestamptz', nullable: true })
  publishedAt: Date | null;

  @Column({ name: 'created_by', type: 'uuid', nullable: true })
  createdBy: string | null;

  @Column({ name: 'updated_by', type: 'uuid', nullable: true })
  updatedBy: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt: Date | null;
}
