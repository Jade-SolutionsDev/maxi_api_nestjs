import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * El umbral del envío gratis pasa a vivir **en cada forma de entrega**.
 *
 * Nació como una regla única de toda la tienda, guardada con los ajustes
 * generales. Al verlo en el panel, Jade señaló lo evidente: estaba dentro de
 * la tarjeta de **recogida**, que es justo el caso donde no hay envío que
 * regalar. Una promoción del envío pertenece a la forma de entrega, y ahí es
 * donde la busca quien la configura.
 *
 * De paso, se gana algo que la versión única no permitía: que una Express de
 * 10 USD sea gratis a partir de 200 y una normal de 5 a partir de 50.
 *
 * En céntimos enteros, como estaba: comparar dólares en coma flotante deja sin
 * promoción a quien compra justo el importe —`9.51 + 10.50` da
 * `20.009999999999998` contra un umbral de 20.01—.
 *
 * El ajuste general se borra del jsonb. No se migra ningún valor porque no
 * llegó a configurarse en ninguna parte: nació ayer y se queda sin estrenar.
 */
export class UmbralDeEnvioGratisPorOpcion1790400000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "delivery_options"
         ADD COLUMN IF NOT EXISTS "free_delivery_threshold_cents" integer`,
    );
    await queryRunner.query(
      `UPDATE "fulfillment_settings"
          SET "data" = "data" - 'freeDeliveryThresholdCents'
        WHERE "data" ? 'freeDeliveryThresholdCents'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "delivery_options"
         DROP COLUMN IF EXISTS "free_delivery_threshold_cents"`,
    );
  }
}
