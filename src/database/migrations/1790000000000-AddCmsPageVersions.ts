import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Textos de la tienda con borrador, versión publicada e historial.
 *
 * `cms_pages.title`/`content` pasan a ser el BORRADOR. Lo que ve la tienda es
 * la fila de `cms_page_versions` a la que apunta `published_version_id`; cada
 * publicación añade una versión con autor y fecha y ninguna se borra, porque
 * son textos legales y hay que poder saber qué decían cuando alguien compró.
 * `kind` separa las páginas informativas de los avisos de la portada, que
 * además pueden llevar fecha de inicio y de fin.
 *
 * Cada página que hoy está en la tienda nace publicada como versión 1, con su
 * texto actual: sin eso, al desplegar desaparecerían todas hasta la primera
 * publicación. Las vacías se quedan en borrador, que es justo lo que la
 * tienda no debe mostrar.
 *
 * Los roles base solo se siembran una vez, así que el «Responsable de la web»
 * que ya existe recibe aquí los permisos de los textos. El catálogo de
 * permisos aún no tiene `cms-pages:publish` cuando corre esta migración (se
 * siembra al arrancar, después), por eso se inserta aquí si falta.
 */
const CMS_PAGES_ACTIONS = [
  'list',
  'read',
  'create',
  'update',
  'delete',
  'publish',
];

export class AddCmsPageVersions1790000000000 implements MigrationInterface {
  name = 'AddCmsPageVersions1790000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "cms_pages"
         ADD COLUMN "kind" character varying(20) NOT NULL DEFAULT 'page',
         ADD COLUMN "starts_at" TIMESTAMP WITH TIME ZONE,
         ADD COLUMN "ends_at" TIMESTAMP WITH TIME ZONE,
         ADD COLUMN "draft_updated_at" TIMESTAMP WITH TIME ZONE,
         ADD COLUMN "draft_updated_by" character varying(160),
         ADD COLUMN "published_version_id" uuid`,
    );

    await queryRunner.query(
      `CREATE TABLE "cms_page_versions" (
         "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
         "page_id" uuid NOT NULL,
         "version" integer NOT NULL,
         "title" character varying(160) NOT NULL,
         "content" text NOT NULL,
         "published_by_id" uuid,
         "published_by_name" character varying(160) NOT NULL,
         "published_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
         CONSTRAINT "PK_cms_page_versions" PRIMARY KEY ("id"),
         CONSTRAINT "FK_cms_page_versions_page" FOREIGN KEY ("page_id")
           REFERENCES "cms_pages"("id") ON DELETE RESTRICT
       )`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_cms_page_versions_page_version" ON "cms_page_versions" ("page_id", "version")`,
    );

    await queryRunner.query(
      `INSERT INTO "cms_page_versions"
         ("page_id", "version", "title", "content", "published_by_name", "published_at")
       SELECT "id", 1, "title", "content", 'Sistema', "updated_at"
         FROM "cms_pages"
        WHERE "deleted_at" IS NULL AND btrim("content") <> ''`,
    );
    await queryRunner.query(
      `UPDATE "cms_pages" p
          SET "published_version_id" = v."id"
         FROM "cms_page_versions" v
        WHERE v."page_id" = p."id" AND v."version" = 1`,
    );
    await queryRunner.query(
      `ALTER TABLE "cms_pages"
         ADD CONSTRAINT "FK_cms_pages_published_version"
         FOREIGN KEY ("published_version_id")
         REFERENCES "cms_page_versions"("id") ON DELETE SET NULL`,
    );

    await queryRunner.query(
      `INSERT INTO "permissions" ("module", "action", "description", "is_active")
       SELECT 'cms-pages', action, action || ' cms-pages', true
         FROM unnest($1::text[]) AS action
       ON CONFLICT ("module", "action") DO NOTHING`,
      [CMS_PAGES_ACTIONS],
    );
    await queryRunner.query(
      `INSERT INTO "role_permissions" ("role_id", "permission_id")
       SELECT r."id", p."id"
         FROM "roles" r
         JOIN "permissions" p ON p."module" = 'cms-pages'
        WHERE r."system_key" = 'WEB_MANAGER' AND r."deleted_at" IS NULL
       ON CONFLICT DO NOTHING`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Sin versiones, la tienda vuelve a leer title/content: que lean lo
    // publicado, no un borrador a medias. Los avisos no existían como
    // páginas, así que se retiran en vez de aparecer en /paginas.
    await queryRunner.query(
      `UPDATE "cms_pages" p
          SET "title" = v."title", "content" = v."content"
         FROM "cms_page_versions" v
        WHERE v."id" = p."published_version_id"`,
    );
    await queryRunner.query(
      `UPDATE "cms_pages"
          SET "is_active" = false, "deleted_at" = now()
        WHERE "kind" = 'home-notice' AND "deleted_at" IS NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "cms_pages" DROP CONSTRAINT IF EXISTS "FK_cms_pages_published_version"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "cms_page_versions"`);
    await queryRunner.query(
      `ALTER TABLE "cms_pages"
         DROP COLUMN IF EXISTS "kind",
         DROP COLUMN IF EXISTS "starts_at",
         DROP COLUMN IF EXISTS "ends_at",
         DROP COLUMN IF EXISTS "draft_updated_at",
         DROP COLUMN IF EXISTS "draft_updated_by",
         DROP COLUMN IF EXISTS "published_version_id"`,
    );
    await queryRunner.query(
      `DELETE FROM "role_permissions" WHERE "permission_id" IN (
         SELECT "id" FROM "permissions"
          WHERE "module" = 'cms-pages' AND "action" = 'publish'
       )`,
    );
    await queryRunner.query(
      `DELETE FROM "permissions" WHERE "module" = 'cms-pages' AND "action" = 'publish'`,
    );
  }
}
