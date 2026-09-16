import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Historial de pedidos: una fila por cada cambio (creación, estado, pago,
 * intento de pago, comprobante, restablecimiento, caducidad) con quién lo
 * hizo y qué había antes. Es la base para dar a la administración capacidad
 * de editar pedidos sin perder el rastro.
 */
export class AddOrderEvents1789400000000 implements MigrationInterface {
  name = 'AddOrderEvents1789400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "order_events" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "order_id" uuid NOT NULL,
        "kind" character varying(40) NOT NULL,
        "actor_kind" character varying(20) NOT NULL,
        "actor_user_id" uuid,
        "actor_client_id" uuid,
        "field" character varying(60),
        "previous_value" character varying(120),
        "next_value" character varying(120),
        "reason" text,
        "meta" jsonb,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_order_events" PRIMARY KEY ("id"),
        CONSTRAINT "FK_order_events_order" FOREIGN KEY ("order_id")
          REFERENCES "orders"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      'CREATE INDEX IF NOT EXISTS "IDX_order_events_order_created" ON "order_events" ("order_id", "created_at")',
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS "order_events"');
  }
}
