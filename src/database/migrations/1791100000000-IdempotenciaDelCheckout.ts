import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Un reintento del checkout deja de crear un pedido nuevo (MxH-0176).
 *
 * La tienda abandona cualquier llamada a la API a los **8 segundos**
 * (`AbortSignal.timeout(8000)` en `src/api/http.ts`), y ese corte es **solo del
 * lado del cliente**: aborta la espera, no la petición. La API sigue
 * trabajando, así que un pedido que se crea en el segundo 9 existe mientras la
 * tienda le dice al comprador que no se pudo. Si reintenta —que es justo lo que
 * el aviso le pide—, compra dos veces.
 *
 * La clave la genera la tienda y viaja en el checkout. Con ella, el segundo
 * intento devuelve el **mismo** pedido en vez de crear otro.
 *
 * **El índice es sobre el par `(client_id, idempotency_key)`, no sobre la clave
 * sola.** Es una decisión de seguridad: la clave la elige quien compra, así que
 * dos clientes podrían mandar la misma, y buscar un pedido solo por ella
 * acabaría enseñándole a uno el pedido del otro.
 *
 * Y es **parcial**. Los pedidos de antes y los que crea el panel no tienen
 * clave: sin el `WHERE`, todos esos nulos competirían por el mismo hueco en
 * cuanto el índice dejara de tolerarlos.
 *
 * `varchar(64)` y no `uuid`: la clave es opaca para la API. Hoy la tienda manda
 * un UUID, pero esto no obliga a que siempre lo sea.
 *
 * Idempotente con `IF NOT EXISTS`, como el resto de la casa.
 */
export class IdempotenciaDelCheckout1791100000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "orders"
         ADD COLUMN IF NOT EXISTS "idempotency_key" varchar(64)`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "ux_orders_client_idempotency"
         ON "orders" ("client_id", "idempotency_key")
       WHERE "idempotency_key" IS NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "ux_orders_client_idempotency"`,
    );
    await queryRunner.query(
      `ALTER TABLE "orders" DROP COLUMN IF EXISTS "idempotency_key"`,
    );
  }
}
