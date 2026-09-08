import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Datos de quien recibe el pedido (MxH-0104).
 *
 * Todo nullable a propósito: las direcciones y los pedidos que ya existen no
 * tienen destinatario ni carnet, y no se les puede inventar uno. La
 * obligatoriedad vive en el checkout, que es donde hay una persona delante a
 * quien preguntarle.
 */
export class AddRecipientDetails1789100000000 implements MigrationInterface {
  name = 'AddRecipientDetails1789100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "client_addresses" ADD COLUMN IF NOT EXISTS "recipient_name" character varying(150)`,
    );
    await queryRunner.query(
      `ALTER TABLE "client_addresses" ADD COLUMN IF NOT EXISTS "id_card" character varying(11)`,
    );
    await queryRunner.query(
      `ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "contact_snapshot" jsonb`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "orders" DROP COLUMN IF EXISTS "contact_snapshot"`,
    );
    await queryRunner.query(
      `ALTER TABLE "client_addresses" DROP COLUMN IF EXISTS "id_card"`,
    );
    await queryRunner.query(
      `ALTER TABLE "client_addresses" DROP COLUMN IF EXISTS "recipient_name"`,
    );
  }
}
