import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Contact vertical: the generic `nomenclators` option catalog (seeded with
 * the contact motives), customer `contact_messages` with their append-only
 * `contact_replies` log, and the `contact_reply_templates` drafts. Bare-uuid
 * references, no foreign keys — house convention.
 */
export class AddContact1787950000000 implements MigrationInterface {
  name = 'AddContact1787950000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "nomenclators" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "category" character varying(60) NOT NULL, "code" character varying(120) NOT NULL, "label" character varying(120) NOT NULL, "description" text, "sort_order" integer NOT NULL DEFAULT '0', "is_active" boolean NOT NULL DEFAULT true, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP, CONSTRAINT "PK_nomenclators" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_nomenclators_category_code" ON "nomenclators" ("category", "code")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_nomenclators_category" ON "nomenclators" ("category")`,
    );

    await queryRunner.query(
      `CREATE TYPE "public"."contact_messages_status_enum" AS ENUM('nuevo', 'en_proceso', 'respondido', 'cerrado')`,
    );
    await queryRunner.query(
      `CREATE TABLE "contact_messages" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "motive_id" uuid NOT NULL, "client_id" uuid, "name" character varying(100), "last_name" character varying(100), "email" character varying(255), "phone" character varying(40), "message" text NOT NULL, "status" "public"."contact_messages_status_enum" NOT NULL DEFAULT 'nuevo', "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP, CONSTRAINT "PK_contact_messages" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_contact_messages_status" ON "contact_messages" ("status")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_contact_messages_created_at" ON "contact_messages" ("created_at")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_contact_messages_motive_id" ON "contact_messages" ("motive_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_contact_messages_client_id" ON "contact_messages" ("client_id")`,
    );

    await queryRunner.query(
      `CREATE TABLE "contact_reply_templates" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "title" character varying(120) NOT NULL, "body" text NOT NULL, "motive_id" uuid, "sort_order" integer NOT NULL DEFAULT '0', "is_active" boolean NOT NULL DEFAULT true, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP, CONSTRAINT "PK_contact_reply_templates" PRIMARY KEY ("id"))`,
    );

    await queryRunner.query(
      `CREATE TYPE "public"."contact_replies_channel_enum" AS ENUM('email', 'whatsapp', 'telefono', 'plataforma', 'nota')`,
    );
    await queryRunner.query(
      `CREATE TABLE "contact_replies" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "message_id" uuid NOT NULL, "user_id" uuid NOT NULL, "channel" "public"."contact_replies_channel_enum" NOT NULL, "template_id" uuid, "body" text, "created_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_contact_replies" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_contact_replies_message_id" ON "contact_replies" ("message_id")`,
    );

    await queryRunner.query(
      `INSERT INTO "nomenclators" ("category", "code", "label", "sort_order") VALUES
        ('contact-motive', 'pedidos', 'Pedidos', 0),
        ('contact-motive', 'pagos-y-facturacion', 'Pagos y facturación', 1),
        ('contact-motive', 'productos', 'Productos', 2),
        ('contact-motive', 'entregas', 'Entregas', 3),
        ('contact-motive', 'sugerencias', 'Sugerencias', 4),
        ('contact-motive', 'otro', 'Otro', 5)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."IDX_contact_replies_message_id"`,
    );
    await queryRunner.query(`DROP TABLE "contact_replies"`);
    await queryRunner.query(
      `DROP TYPE "public"."contact_replies_channel_enum"`,
    );
    await queryRunner.query(`DROP TABLE "contact_reply_templates"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_contact_messages_client_id"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_contact_messages_motive_id"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_contact_messages_created_at"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_contact_messages_status"`,
    );
    await queryRunner.query(`DROP TABLE "contact_messages"`);
    await queryRunner.query(
      `DROP TYPE "public"."contact_messages_status_enum"`,
    );
    await queryRunner.query(`DROP INDEX "public"."IDX_nomenclators_category"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_nomenclators_category_code"`,
    );
    await queryRunner.query(`DROP TABLE "nomenclators"`);
  }
}
