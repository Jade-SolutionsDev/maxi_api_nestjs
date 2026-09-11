import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Métodos de pago que define el admin (banco, QR, enlace, cripto) y el
 * comprobante que manda el cliente.
 *
 * Escrita a mano: `migration:generate` arrastra hoy diferencias ajenas entre
 * las entidades y la base (timestamps de contacto y nomencladores, índices
 * parciales) que incluyen DROP COLUMN y se llevarían datos por delante.
 */
export class MetodosDePagoManuales1789144000000 implements MigrationInterface {
  name = 'MetodosDePagoManuales1789144000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "payment_methods" ADD COLUMN IF NOT EXISTS "is_custom" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "payment_methods" ADD COLUMN IF NOT EXISTS "instructions" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "payment_methods" ADD COLUMN IF NOT EXISTS "deleted_at" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "payment_charges" ADD COLUMN IF NOT EXISTS "customer_reference" character varying(200)`,
    );
    await queryRunner.query(
      `ALTER TABLE "payment_charges" ADD COLUMN IF NOT EXISTS "receipt_url" text`,
    );

    // Gestionar cobros pasa a ser cosa de ADMIN/SUPER_ADMIN, como usuarios y
    // permisos: quien lo toca decide a qué cuenta va el dinero. Los permisos
    // concedibles que existían se borran, y con ellos sus concesiones — si no,
    // un empleado seguiría viendo la pantalla en el menú para chocar con un 403
    // (el mapa de permisos del front sale de estas filas, no del catálogo).
    await queryRunner.query(
      `DELETE FROM "role_permissions" WHERE "permission_id" IN (
         SELECT "id" FROM "permissions" WHERE "module" = 'payment-methods'
       )`,
    );
    await queryRunner.query(
      `DELETE FROM "permissions" WHERE "module" = 'payment-methods'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "payment_charges" DROP COLUMN IF EXISTS "receipt_url"`,
    );
    await queryRunner.query(
      `ALTER TABLE "payment_charges" DROP COLUMN IF EXISTS "customer_reference"`,
    );
    await queryRunner.query(
      `ALTER TABLE "payment_methods" DROP COLUMN IF EXISTS "deleted_at"`,
    );
    await queryRunner.query(
      `ALTER TABLE "payment_methods" DROP COLUMN IF EXISTS "instructions"`,
    );
    await queryRunner.query(
      `ALTER TABLE "payment_methods" DROP COLUMN IF EXISTS "is_custom"`,
    );
    // Los permisos los vuelve a sembrar el arranque si alguien repone el módulo
    // en MODULE_ACTIONS; las concesiones borradas no se reponen solas.
  }
}
