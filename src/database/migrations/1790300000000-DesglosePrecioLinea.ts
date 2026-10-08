import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Guardar en cada línea de pedido **de dónde salió el precio**.
 *
 * Hoy la línea solo conserva `unit_price`, que es lo cobrado. Eso está bien
 * congelado —cambiar el precio de un producto no altera pedidos viejos—, pero
 * es el resultado y no el desglose: no dice si se vendió a 80 porque el
 * producto valía 80 o porque valía 100 con un 20% de rebaja.
 *
 * El dato existe en el momento de la compra y se pierde en cuanto alguien
 * cambia el precio del producto, así que cada pedido que entra sin esto nace
 * incompleto (MxH-0056).
 *
 * **Las columnas quedan nulas en lo ya existente, a propósito.** De una línea
 * vieja se conoce lo cobrado y nada más; poner `list_price = unit_price` y
 * `discount = 0` afirmaría que no hubo rebaja, que es falso en todas las que
 * sí la tuvieron. Un nulo dice «esto no se registró», que es la verdad.
 *
 * No se guarda ningún precio de coste: la tienda no los maneja (decidido por
 * Jade el 8-oct-2026). Inventarlo para rellenar un hueco acabaría en un
 * informe de márgenes dentro de un año sin que nadie recuerde que era un
 * invento.
 */
export class DesglosePrecioLinea1790300000000 implements MigrationInterface {
  name = 'DesglosePrecioLinea1790300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "order_items" ADD COLUMN IF NOT EXISTS "list_price" numeric(12,2)`,
    );
    await queryRunner.query(
      `ALTER TABLE "order_items" ADD COLUMN IF NOT EXISTS "discount" numeric(5,2)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "order_items" DROP COLUMN IF EXISTS "discount"`,
    );
    await queryRunner.query(
      `ALTER TABLE "order_items" DROP COLUMN IF EXISTS "list_price"`,
    );
  }
}
