import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Tickets internos (MxH-0065): `tickets` con su historial `ticket_events`, que
 * solo crece, y las categorías sembradas en el catálogo `nomenclators` que ya
 * existe.
 *
 * Referencias por uuid pelado, sin claves ajenas: convención de la casa.
 *
 * Las categorías se siembran porque sin ninguna no se puede abrir nada, y el
 * módulo nacería inservible hasta que alguien se acordara de crearlas. Son
 * editables desde el panel como cualquier otro nomenclador — estas siete son
 * un punto de partida, no una taxonomía cerrada.
 */
export class TicketsInternos1791300000000 implements MigrationInterface {
  name = 'TicketsInternos1791300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."tickets_status_enum" AS ENUM('abierto', 'en_curso', 'resuelto', 'cerrado')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."tickets_priority_enum" AS ENUM('baja', 'media', 'alta')`,
    );
    await queryRunner.query(
      `CREATE TABLE "tickets" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "title" character varying(160) NOT NULL, "description" text NOT NULL, "category_id" uuid NOT NULL, "priority" "public"."tickets_priority_enum" NOT NULL DEFAULT 'media', "status" "public"."tickets_status_enum" NOT NULL DEFAULT 'abierto', "assigned_user_id" uuid, "created_by_user_id" uuid NOT NULL, "images" jsonb NOT NULL DEFAULT '[]'::jsonb, "resolution" text, "resolved_at" TIMESTAMP WITH TIME ZONE, "closed_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP, CONSTRAINT "PK_tickets" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_tickets_status" ON "tickets" ("status")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_tickets_priority" ON "tickets" ("priority")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_tickets_category_id" ON "tickets" ("category_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_tickets_assigned_user_id" ON "tickets" ("assigned_user_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_tickets_created_at" ON "tickets" ("created_at")`,
    );

    await queryRunner.query(
      `CREATE TYPE "public"."ticket_events_kind_enum" AS ENUM('abierto', 'estado', 'asignado', 'editado', 'comentario')`,
    );
    await queryRunner.query(
      `CREATE TABLE "ticket_events" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "ticket_id" uuid NOT NULL, "user_id" uuid NOT NULL, "kind" "public"."ticket_events_kind_enum" NOT NULL, "from_status" character varying(20), "to_status" character varying(20), "note" text, "created_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_ticket_events" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ticket_events_ticket_id" ON "ticket_events" ("ticket_id")`,
    );

    await queryRunner.query(
      `INSERT INTO "nomenclators" ("category", "code", "label", "sort_order") VALUES
        ('ticket-category', 'sistema-o-panel', 'Sistema o panel', 0),
        ('ticket-category', 'equipos-y-dispositivos', 'Equipos y dispositivos', 1),
        ('ticket-category', 'almacen-e-inventario', 'Almacén e inventario', 2),
        ('ticket-category', 'entregas-y-reparto', 'Entregas y reparto', 3),
        ('ticket-category', 'cobros-y-pagos', 'Cobros y pagos', 4),
        ('ticket-category', 'local-e-instalaciones', 'Local e instalaciones', 5),
        ('ticket-category', 'otro', 'Otro', 6)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM "nomenclators" WHERE "category" = 'ticket-category'`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_ticket_events_ticket_id"`,
    );
    await queryRunner.query(`DROP TABLE "ticket_events"`);
    await queryRunner.query(`DROP TYPE "public"."ticket_events_kind_enum"`);

    await queryRunner.query(`DROP INDEX "public"."IDX_tickets_created_at"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_tickets_assigned_user_id"`,
    );
    await queryRunner.query(`DROP INDEX "public"."IDX_tickets_category_id"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_tickets_priority"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_tickets_status"`);
    await queryRunner.query(`DROP TABLE "tickets"`);
    await queryRunner.query(`DROP TYPE "public"."tickets_priority_enum"`);
    await queryRunner.query(`DROP TYPE "public"."tickets_status_enum"`);
  }
}
