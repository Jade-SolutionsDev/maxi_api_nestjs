import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The dashboard lands on every login and scans a 60-day slice of `orders` and
 * `clients` by `created_at`. `orders` only had an index on `client_id` and
 * `clients` had none at all, so both aggregates were sequential scans of the
 * whole table on every page load.
 *
 * Partial, matching the queries' own predicate: the aggregates never look at
 * soft-deleted rows, so neither does the index.
 *
 * `products` gets nothing: its statement counts the whole active catalogue with
 * no date range, so it is a full scan whatever we index.
 *
 * Plain CREATE INDEX, not CONCURRENTLY — migrations run inside a transaction
 * here and CONCURRENTLY cannot. It takes a brief write lock; at this table size
 * that is milliseconds.
 */
export class DashboardStatsIndexes1788050000000 implements MigrationInterface {
  name = 'DashboardStatsIndexes1788050000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_orders_created_at_active"
         ON "orders" ("created_at") WHERE "deleted_at" IS NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_clients_created_at_active"
         ON "clients" ("created_at") WHERE "deleted_at" IS NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_clients_created_at_active"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_orders_created_at_active"`,
    );
  }
}
