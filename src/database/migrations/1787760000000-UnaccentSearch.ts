import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Searching "Habana" used to miss "Habána", and searching "Almacen" missed
 * "Almacén" — which in Spanish is most of the time. `unaccent` folds the
 * accents on both sides of the comparison.
 *
 * The wrapper exists because `unaccent()` is not IMMUTABLE (it depends on a
 * dictionary that could change), and PostgreSQL refuses to index a call it
 * cannot promise is stable. Pinning the dictionary by name makes it one this
 * database will answer the same way every time, which is what lets the trigram
 * indexes below exist at all.
 */
export class UnaccentSearch1787760000000 implements MigrationInterface {
  name = 'UnaccentSearch1787760000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS unaccent`);
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS pg_trgm`);
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION f_unaccent(text)
        RETURNS text
        LANGUAGE sql
        IMMUTABLE PARALLEL SAFE STRICT
      AS $$ SELECT public.unaccent('public.unaccent', $1) $$
    `);

    // Without these, every search becomes a sequential scan over the table.
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_products_name_unaccent
        ON products USING gin (f_unaccent(name) gin_trgm_ops)
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_categories_name_unaccent
        ON categories USING gin (f_unaccent(name) gin_trgm_ops)
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_stock_locations_name_unaccent
        ON stock_locations USING gin (f_unaccent(name) gin_trgm_ops)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_stock_locations_name_unaccent`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_categories_name_unaccent`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_products_name_unaccent`);
    await queryRunner.query(`DROP FUNCTION IF EXISTS f_unaccent(text)`);
    // Las extensiones se quedan: otras cosas pueden estar usandolas.
  }
}
