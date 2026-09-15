import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Un pedido cancelado puede volver a «pendiente» desde la administración
 * («Restablecer orden»). Estas dos columnas dejan rastro de quién lo hizo y
 * cuándo, y además reinician el plazo de pago: la caducidad cuenta desde
 * `reinstated_at` y no desde `created_at`, que puede llevar días atrás.
 */
export class AddOrderReinstatement1789300000000 implements MigrationInterface {
  name = 'AddOrderReinstatement1789300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "reinstated_at" timestamptz NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "reinstated_by" uuid NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "orders" DROP COLUMN IF EXISTS "reinstated_by"`,
    );
    await queryRunner.query(
      `ALTER TABLE "orders" DROP COLUMN IF EXISTS "reinstated_at"`,
    );
  }
}
