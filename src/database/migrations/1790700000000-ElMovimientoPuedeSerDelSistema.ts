import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Un movimiento de inventario puede no tener detrás a una persona.
 *
 * Hasta ahora toda fila de `inventory_operations` llevaba el administrador que
 * la provocó, porque todas salían del asistente del panel o de que alguien
 * confirmara un pedido a mano. Con `MxH-0170` el pago confirma el pedido solo,
 * y la salida de mercancía que eso genera la firma el sistema: cuando el aviso
 * llega por webhook no hay ningún usuario a quien atribuirla.
 *
 * `created_by` pasa a admitir nulo, que es como el resto del sistema ya dice
 * «esto lo hizo el sistema» —los eventos del pedido llevan `actor.system`—. El
 * libro de movimientos no se resiente: su consulta ya usa `LEFT JOIN users` y
 * su DTO ya declara `actorId` y `actorName` como anulables.
 */
export class ElMovimientoPuedeSerDelSistema1790700000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "inventory_operations" ALTER COLUMN "created_by" DROP NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Las filas del sistema no tienen a quién atribuirse, así que volver atrás
    // con alguna presente fallaría. Se borran: son el rastro de una función
    // que esta reversión también quita.
    await queryRunner.query(
      `DELETE FROM "inventory_operation_items"
        WHERE "operation_id" IN (
          SELECT "id" FROM "inventory_operations" WHERE "created_by" IS NULL
        )`,
    );
    await queryRunner.query(
      `DELETE FROM "inventory_operations" WHERE "created_by" IS NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "inventory_operations" ALTER COLUMN "created_by" SET NOT NULL`,
    );
  }
}
