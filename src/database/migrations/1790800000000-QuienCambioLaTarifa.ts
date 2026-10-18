import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Quién tocó la tarifa y el plazo de una forma de entrega.
 *
 * `MxH-0041` pedía que los cambios de coste y plazo quedaran «con autor y
 * fecha». La fecha estaba —`created_at` y `updated_at`—, el autor no: la
 * tarifa es dinero que paga el cliente y hasta ahora se podía cambiar sin que
 * quedara constancia de quién.
 *
 * Anulables porque las filas que ya existen no tienen a quién atribuirse, y
 * porque una opción sembrada por una migración tampoco tiene autor.
 */
export class QuienCambioLaTarifa1790800000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "delivery_options"
         ADD COLUMN IF NOT EXISTS "created_by" uuid,
         ADD COLUMN IF NOT EXISTS "updated_by" uuid`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "delivery_options"
         DROP COLUMN IF EXISTS "created_by",
         DROP COLUMN IF EXISTS "updated_by"`,
    );
  }
}
