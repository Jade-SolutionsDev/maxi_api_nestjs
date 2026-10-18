import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * El aviso emergente de la tienda (`MxH-0037`).
 *
 * Tabla propia y no un `kind` más de `cms_pages`: una página del CMS es
 * título y Markdown, y esto lleva imagen en tres medidas y un botón.
 *
 * Las fechas se copian de `cms_pages` —son las que hacen que el aviso se
 * retire solo— y las tres imágenes de `cms_banners`, que ya resolvió el
 * problema de no servirle a un teléfono la imagen del escritorio.
 */
export class AvisoEmergente1790900000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "cms_popups" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "title" character varying(160) NOT NULL,
        "body" text NOT NULL,
        "button_label" character varying(60),
        "button_href" character varying(300),
        "desktop" jsonb,
        "tablet" jsonb,
        "mobile" jsonb,
        "starts_at" TIMESTAMP WITH TIME ZONE,
        "ends_at" TIMESTAMP WITH TIME ZONE,
        "repeat_after_hours" integer,
        "is_active" boolean NOT NULL DEFAULT true,
        "published_at" TIMESTAMP WITH TIME ZONE,
        "created_by" uuid,
        "updated_by" uuid,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMP WITH TIME ZONE,
        CONSTRAINT "PK_cms_popups" PRIMARY KEY ("id"),
        CONSTRAINT "CK_cms_popups_imagenes" CHECK (
          ("desktop" IS NULL) = ("tablet" IS NULL)
          AND ("desktop" IS NULL) = ("mobile" IS NULL)
        ),
        CONSTRAINT "CK_cms_popups_fechas" CHECK (
          "starts_at" IS NULL OR "ends_at" IS NULL OR "ends_at" > "starts_at"
        ),
        CONSTRAINT "CK_cms_popups_boton" CHECK (
          "button_href" IS NULL OR "button_label" IS NOT NULL
        )
      )
    `);

    // La tienda pide el aviso vigente en cada visita: que no recorra la tabla.
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_cms_popups_vigente"
        ON "cms_popups" ("is_active", "published_at")
        WHERE "deleted_at" IS NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_cms_popups_vigente"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "cms_popups"`);
  }
}
