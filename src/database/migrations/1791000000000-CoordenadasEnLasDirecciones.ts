import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Una dirección guardada puede llevar **un punto en el mapa** (MxH-0071).
 *
 * En Cuba muchas direcciones no se encuentran solo por escrito, y el punto le
 * ahorra vueltas a quien reparte. Pero es **siempre opcional**: la dirección
 * escrita sigue siendo con la que se entrega, y nadie pierde una compra por
 * negarle al navegador el permiso de ubicación (decisión `D-011` del grafo).
 * De ahí que las tres columnas sean nulables y sin valor por omisión: las
 * direcciones que ya existen no tienen punto y no se les puede inventar uno.
 *
 * `numeric(9,6)` para las dos: seis decimales son unos 11 cm, de sobra para
 * encontrar un portal, y los tres dígitos enteros cubren el rango completo
 * (-90..90 y -180..180). Más precisión sería fingir que el dedo de alguien en
 * un teléfono acierta al centímetro.
 *
 * `location_source` es `varchar` y no un tipo enum de Postgres, al revés que
 * `orders.status`: hoy tiene dos valores —`device`, del GPS, y `manual`, del
 * marcador arrastrado— pero añadir «importado» o «corregido por el
 * repartidor» es plausible, y con un enum nativo cada valor nuevo es un
 * `ALTER TYPE`. El conjunto válido lo guarda el enum de TypeScript.
 *
 * **No lleva índice**, a propósito. No hay búsqueda por proximidad ni
 * geocodificación —`D-010` descarta las dos—, así que un índice sería peso sin
 * lector. El día que haga falta «pedidos cerca de aquí», se añade entonces.
 *
 * Idempotente con `IF NOT EXISTS`, como el resto de la casa: volver a
 * ejecutarla donde ya se aplicó no toca nada.
 */
export class CoordenadasEnLasDirecciones1791000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "client_addresses"
         ADD COLUMN IF NOT EXISTS "latitude"        numeric(9,6),
         ADD COLUMN IF NOT EXISTS "longitude"       numeric(9,6),
         ADD COLUMN IF NOT EXISTS "location_source" varchar(10)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "client_addresses"
         DROP COLUMN IF EXISTS "latitude",
         DROP COLUMN IF EXISTS "longitude",
         DROP COLUMN IF EXISTS "location_source"`,
    );
  }
}
