import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Tablas de preguntas frecuentes del CMS. Solo el esquema: el contenido lo
 * redacta la administración. Hasta el 16-sep-2026 esta migración sembraba 3
 * categorías y 17 preguntas sobre Mi Billetera; al desplegar en producción
 * aparecieron en la tienda sin que nadie las hubiera pedido y hubo que
 * borrarlas a mano. Los entornos ya migrados no se ven afectados por este
 * cambio (la migración consta como aplicada); los nuevos nacen vacíos.
 */
export class AddCmsFaq1788820000000 implements MigrationInterface {
  name = 'AddCmsFaq1788820000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "cms_faq_categories" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "title" character varying(160) NOT NULL,
        "sort_order" integer NOT NULL DEFAULT 0,
        "is_active" boolean NOT NULL DEFAULT true,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMP WITH TIME ZONE,
        CONSTRAINT "PK_cms_faq_categories" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      CREATE TABLE "cms_faq_questions" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "category_id" uuid NOT NULL,
        "question" character varying(300) NOT NULL,
        "answer" text NOT NULL,
        "link_label" character varying(120),
        "link_href" character varying(500),
        "sort_order" integer NOT NULL DEFAULT 0,
        "is_active" boolean NOT NULL DEFAULT true,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMP WITH TIME ZONE,
        CONSTRAINT "PK_cms_faq_questions" PRIMARY KEY ("id"),
        CONSTRAINT "FK_cms_faq_questions_category" FOREIGN KEY ("category_id")
          REFERENCES "cms_faq_categories"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      'CREATE INDEX "IDX_cms_faq_categories_public_order" ON "cms_faq_categories" ("is_active", "sort_order") WHERE "deleted_at" IS NULL',
    );
    await queryRunner.query(
      'CREATE INDEX "IDX_cms_faq_questions_category_order" ON "cms_faq_questions" ("category_id", "is_active", "sort_order") WHERE "deleted_at" IS NULL',
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE "cms_faq_questions"');
    await queryRunner.query('DROP TABLE "cms_faq_categories"');
  }
}
