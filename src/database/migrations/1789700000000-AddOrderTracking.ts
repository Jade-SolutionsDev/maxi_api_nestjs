import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * El enlace de seguimiento del pedido (MxH-0059).
 *
 * `tracking_id` es público y viaja en una URL que el cliente guarda en el
 * móvil, así que se genera con 32 bytes aleatorios: largo, no adivinable y sin
 * relación con el número de pedido, que es correlativo y delataría el volumen
 * del negocio además de permitir tantear los de al lado.
 *
 * Los pedidos que ya existen reciben el suyo aquí mismo — si no, el enlace
 * solo funcionaría para los nuevos y habría que explicar por qué.
 */
export class AddOrderTracking1789700000000 implements MigrationInterface {
  name = 'AddOrderTracking1789700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "orders" ADD COLUMN "tracking_id" character varying(64)`,
    );

    // pgcrypto suele estar; si no, se usa md5(random()) repetido, que da los
    // mismos 64 caracteres hexadecimales sin depender de la extensión.
    // La aserción es explícita a propósito: `query()` devuelve `any`, y
    // asignarlo a un tipo sin decirlo deja al linter sin forma de distinguir
    // esto de un descuido.
    const tieneGen = (await queryRunner.query(
      `SELECT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'gen_random_bytes') AS existe`,
    )) as { existe: boolean }[];
    const expresion = tieneGen[0]?.existe
      ? `encode(gen_random_bytes(32), 'hex')`
      : `md5(random()::text || clock_timestamp()::text) || md5(random()::text || id::text)`;

    await queryRunner.query(
      `UPDATE "orders" SET "tracking_id" = ${expresion} WHERE "tracking_id" IS NULL`,
    );

    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_orders_tracking_id" ON "orders" ("tracking_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_orders_tracking_id"`);
    await queryRunner.query(
      `ALTER TABLE "orders" DROP COLUMN IF EXISTS "tracking_id"`,
    );
  }
}
