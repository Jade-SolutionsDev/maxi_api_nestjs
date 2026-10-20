import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Quejas del Call Center (MxH-0064): `complaints` con su historial
 * `complaint_events`, que solo crece, y los motivos sembrados en el catálogo
 * `nomenclators` que ya existe.
 *
 * Referencias por uuid pelado, sin claves ajenas: convención de la casa.
 *
 * Los motivos se siembran porque sin ninguno no se puede registrar nada, y el
 * módulo nacería inservible hasta que alguien se acordara de crearlos. Son
 * editables desde el panel como cualquier otro nomenclador.
 */
export class QuejasDeClientes1791200000000 implements MigrationInterface {
  name = 'QuejasDeClientes1791200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."complaints_status_enum" AS ENUM('abierta', 'en_gestion', 'resuelta')`,
    );
    await queryRunner.query(
      `CREATE TABLE "complaints" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "client_id" uuid NOT NULL, "order_id" uuid, "motive_id" uuid NOT NULL, "description" text NOT NULL, "status" "public"."complaints_status_enum" NOT NULL DEFAULT 'abierta', "assigned_user_id" uuid, "created_by_user_id" uuid NOT NULL, "resolution" text, "resolved_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP, CONSTRAINT "PK_complaints" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_complaints_status" ON "complaints" ("status")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_complaints_created_at" ON "complaints" ("created_at")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_complaints_motive_id" ON "complaints" ("motive_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_complaints_client_id" ON "complaints" ("client_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_complaints_order_id" ON "complaints" ("order_id")`,
    );

    await queryRunner.query(
      `CREATE TYPE "public"."complaint_events_kind_enum" AS ENUM('registrada', 'estado', 'asignada', 'editada', 'nota')`,
    );
    await queryRunner.query(
      `CREATE TABLE "complaint_events" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "complaint_id" uuid NOT NULL, "user_id" uuid NOT NULL, "kind" "public"."complaint_events_kind_enum" NOT NULL, "from_status" character varying(20), "to_status" character varying(20), "note" text, "created_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_complaint_events" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_complaint_events_complaint_id" ON "complaint_events" ("complaint_id")`,
    );

    await queryRunner.query(
      `INSERT INTO "nomenclators" ("category", "code", "label", "sort_order") VALUES
        ('complaint-motive', 'pedido-incompleto', 'Pedido incompleto', 0),
        ('complaint-motive', 'producto-en-mal-estado', 'Producto en mal estado', 1),
        ('complaint-motive', 'entrega-fuera-de-plazo', 'Entrega fuera de plazo', 2),
        ('complaint-motive', 'producto-equivocado', 'Producto equivocado', 3),
        ('complaint-motive', 'cobro-incorrecto', 'Cobro incorrecto', 4),
        ('complaint-motive', 'trato-recibido', 'Trato recibido', 5),
        ('complaint-motive', 'otro', 'Otro', 6)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM "nomenclators" WHERE "category" = 'complaint-motive'`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_complaint_events_complaint_id"`,
    );
    await queryRunner.query(`DROP TABLE "complaint_events"`);
    await queryRunner.query(`DROP TYPE "public"."complaint_events_kind_enum"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_complaints_order_id"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_complaints_client_id"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_complaints_motive_id"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_complaints_created_at"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_complaints_status"`);
    await queryRunner.query(`DROP TABLE "complaints"`);
    await queryRunner.query(`DROP TYPE "public"."complaints_status_enum"`);
  }
}
