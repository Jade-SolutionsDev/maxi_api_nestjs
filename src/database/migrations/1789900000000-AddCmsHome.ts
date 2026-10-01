import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Portada configurable: borrador, copia publicada e historial.
 *
 * `cms_home` es una sola fila con dos documentos: `draft` (lo que edita el
 * responsable de la web) y `published` (lo que sirve la tienda). Los banners
 * del borrador siguen siendo las filas de `cms_banners`; al publicar se copian
 * dentro de `published`.
 *
 * La fila nace ya publicada con los banners activos de hoy y el orden de
 * secciones que la tienda tenía fijo en el código. Sin eso, al desplegar la
 * portada se quedaría sin banners hasta la primera publicación — y cualquier
 * banner que alguien editara antes saldría a la tienda sin pasar por la vista
 * previa. El orden va escrito aquí y no importado: una migración describe la
 * base de datos de un momento, no el código de mañana.
 */
const INITIAL_LAYOUT = {
  sections: [
    'hero',
    'departments',
    'featured-products',
    'services',
    'on-sale-products',
    'categories',
    'recent-products',
  ].map((key) => ({ key, isVisible: true })),
  featuredProductIds: [],
  featuredDepartmentIds: [],
};

export class AddCmsHome1789900000000 implements MigrationInterface {
  name = 'AddCmsHome1789900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "cms_banners"
         ADD COLUMN "title" character varying(80),
         ADD COLUMN "subtitle" character varying(160)`,
    );

    await queryRunner.query(
      `CREATE TABLE "cms_home" (
         "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
         "draft" jsonb NOT NULL,
         "published" jsonb,
         "draft_updated_at" TIMESTAMP WITH TIME ZONE,
         "draft_updated_by" character varying(160),
         "published_at" TIMESTAMP WITH TIME ZONE,
         "published_by" character varying(160),
         "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
         "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
         CONSTRAINT "PK_cms_home" PRIMARY KEY ("id")
       )`,
    );

    await queryRunner.query(
      `CREATE TABLE "cms_home_changes" (
         "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
         "action" character varying(30) NOT NULL,
         "subject" character varying(160),
         "actor_id" uuid,
         "actor_name" character varying(160) NOT NULL,
         "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
         CONSTRAINT "PK_cms_home_changes" PRIMARY KEY ("id")
       )`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_cms_home_changes_created_at" ON "cms_home_changes" ("created_at")`,
    );

    await queryRunner.query(
      `INSERT INTO "cms_home" ("draft", "published", "published_at", "published_by")
       SELECT $1::jsonb,
              $1::jsonb || jsonb_build_object('banners', COALESCE((
                SELECT jsonb_agg(jsonb_build_object(
                         'id', b.id,
                         'alt', b.alt,
                         'title', b.title,
                         'subtitle', b.subtitle,
                         'desktop', b.desktop,
                         'tablet', b.tablet,
                         'mobile', b.mobile,
                         'targetType', b.target_type,
                         'targetId', b.target_id
                       ) ORDER BY b.sort_order, b.created_at)
                  FROM "cms_banners" b
                 WHERE b.is_active AND b.deleted_at IS NULL
              ), '[]'::jsonb)),
              now(),
              'Sistema'
        WHERE NOT EXISTS (SELECT 1 FROM "cms_home")`,
      [JSON.stringify(INITIAL_LAYOUT)],
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "cms_home_changes"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "cms_home"`);
    await queryRunner.query(
      `ALTER TABLE "cms_banners"
         DROP COLUMN IF EXISTS "title",
         DROP COLUMN IF EXISTS "subtitle"`,
    );
  }
}
