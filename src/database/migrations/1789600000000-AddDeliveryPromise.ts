import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * El plazo de entrega (MxH-0092). El módulo de entregas tenía tarifa pero no
 * plazo: faltaba la mitad del compromiso con el cliente.
 *
 * - `delivery_options.promise_days`: los días hábiles que promete esa opción.
 *   Nulo = sin compromiso publicado, que es lo honesto mientras no haya
 *   reparto activo.
 * - `orders.promise_days`: copia congelada al crear el pedido, como ya se
 *   congelan la etiqueta y la tarifa. Cambiar el plazo mañana no reescribe lo
 *   prometido ayer.
 * - `orders.promised_at`: la fecha comprometida, sellada cuando entra el pago.
 *
 * Si se cumplió no se guarda: se deduce comparando `delivered_at` con
 * `promised_at`, y un dato derivado guardado aparte acaba mintiendo.
 */
export class AddDeliveryPromise1789600000000 implements MigrationInterface {
  name = 'AddDeliveryPromise1789600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "delivery_options" ADD "promise_days" integer`,
    );
    await queryRunner.query(`ALTER TABLE "orders" ADD "promise_days" integer`);
    await queryRunner.query(
      `ALTER TABLE "orders" ADD "promised_at" TIMESTAMP WITH TIME ZONE`,
    );
    // Para la pantalla de «qué vence hoy» (MxH-0013): lo pendiente, por fecha.
    await queryRunner.query(
      `CREATE INDEX "IDX_orders_promised_at" ON "orders" ("promised_at") WHERE "promised_at" IS NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."IDX_orders_promised_at"`);
    await queryRunner.query(`ALTER TABLE "orders" DROP COLUMN "promised_at"`);
    await queryRunner.query(`ALTER TABLE "orders" DROP COLUMN "promise_days"`);
    await queryRunner.query(
      `ALTER TABLE "delivery_options" DROP COLUMN "promise_days"`,
    );
  }
}
