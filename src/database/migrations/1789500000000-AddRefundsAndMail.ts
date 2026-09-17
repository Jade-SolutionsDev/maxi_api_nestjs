import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Devoluciones de dinero (MxH-0048) y correo saliente.
 *
 * - `refunds`: una fila por devolución, con quién la pidió, quién confirmó que
 *   el dinero salió y a dónde. Varias por pedido, para las parciales.
 * - `email_log`: qué correo salió, a quién y cuándo. Es la prueba de los
 *   avisos de custodia y el candado que evita repetirlos.
 * - `orders.paid_at` / `delivered_at` / `delivered_by` / `picked_up_by`: los
 *   dos relojes que la política necesita y que no existían — desde cuándo
 *   corre la custodia y desde cuándo el plazo para reclamar.
 *
 * `paid_at` se rellena hacia atrás desde el cobro que salió bien, que es el
 * único dato real de cuándo entró el dinero. Los pedidos sin cobro registrado
 * (marcados a mano) se quedan sin fecha a propósito: inventarla pondría en
 * marcha recordatorios y plazos sobre una suposición.
 */
export class AddRefundsAndMail1789500000000 implements MigrationInterface {
  name = 'AddRefundsAndMail1789500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "refunds" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "order_id" uuid NOT NULL, "amount" numeric(12,2) NOT NULL, "currency" character varying(10) NOT NULL DEFAULT 'USD', "status" character varying(20) NOT NULL DEFAULT 'requested', "method" character varying(20) NOT NULL DEFAULT 'manual', "origin" character varying(20) NOT NULL DEFAULT 'admin', "reason" text NOT NULL, "destination" character varying(255), "provider_ref" character varying(255), "notes" text, "requested_by" uuid, "requested_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "completed_by" uuid, "completed_at" TIMESTAMP WITH TIME ZONE, "rejected_by" uuid, "rejected_at" TIMESTAMP WITH TIME ZONE, "rejection_reason" text, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_refunds" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_refunds_order" ON "refunds" ("order_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_refunds_status_requested" ON "refunds" ("status", "requested_at")`,
    );

    await queryRunner.query(
      `CREATE TABLE "email_log" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "template" character varying(60) NOT NULL, "to_address" character varying(255) NOT NULL, "subject" character varying(255) NOT NULL, "order_id" uuid, "status" character varying(20) NOT NULL, "provider_id" character varying(255), "error_message" text, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_email_log" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_email_log_order_template" ON "email_log" ("order_id", "template")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_email_log_created" ON "email_log" ("created_at")`,
    );

    await queryRunner.query(
      `ALTER TABLE "orders" ADD "paid_at" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "orders" ADD "delivered_at" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(`ALTER TABLE "orders" ADD "delivered_by" uuid`);
    await queryRunner.query(`ALTER TABLE "orders" ADD "picked_up_by" jsonb`);

    // Cuándo entró el dinero, según el cobro que salió bien. Si hubo varios
    // intentos, el primero que llegó a SUCCEEDED.
    await queryRunner.query(
      `UPDATE "orders" o
         SET "paid_at" = c."completed_at"
        FROM (
          SELECT DISTINCT ON ("order_id") "order_id", "completed_at"
            FROM "payment_charges"
           WHERE "status" = 'SUCCEEDED' AND "completed_at" IS NOT NULL
           ORDER BY "order_id", "completed_at" ASC
        ) c
       WHERE c."order_id" = o."id"
         AND o."payment_status" IN ('paid', 'refunded')`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "orders" DROP COLUMN "picked_up_by"`);
    await queryRunner.query(`ALTER TABLE "orders" DROP COLUMN "delivered_by"`);
    await queryRunner.query(`ALTER TABLE "orders" DROP COLUMN "delivered_at"`);
    await queryRunner.query(`ALTER TABLE "orders" DROP COLUMN "paid_at"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_email_log_created"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_email_log_order_template"`,
    );
    await queryRunner.query(`DROP TABLE "email_log"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_refunds_status_requested"`,
    );
    await queryRunner.query(`DROP INDEX "public"."IDX_refunds_order"`);
    await queryRunner.query(`DROP TABLE "refunds"`);
  }
}
