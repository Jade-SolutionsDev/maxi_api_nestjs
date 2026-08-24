import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Saved delivery addresses for storefront customers (MxH-0053).
 *
 * First migration of the project. Everything that existed before it was created
 * by `synchronize` in the environments where it is on, so this does NOT try to
 * baseline the whole schema — it adds one table to a database that already has
 * the rest.
 */
export class CreateClientAddresses1787578200000 implements MigrationInterface {
  name = 'CreateClientAddresses1787578200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // uuid_generate_v4() is what synchronize uses for primary keys, so the
    // extension has to be there for the default to resolve. Idempotent.
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);

    await queryRunner.query(`
      CREATE TABLE "client_addresses" (
        "id"              uuid NOT NULL DEFAULT uuid_generate_v4(),
        "client_id"       uuid NOT NULL,
        "label"           character varying(100),
        "street"          character varying(300) NOT NULL,
        "between_streets" character varying(200),
        "reference"       text,
        "municipality_id" uuid NOT NULL,
        "contact_phone"   character varying(20),
        "is_default"      boolean NOT NULL DEFAULT false,
        "created_at"      TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at"      TIMESTAMP NOT NULL DEFAULT now(),
        "deleted_at"      TIMESTAMP,
        CONSTRAINT "PK_client_addresses" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(
      `CREATE INDEX "IDX_client_addresses_client_id" ON "client_addresses" ("client_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."IDX_client_addresses_client_id"`,
    );
    await queryRunner.query(`DROP TABLE "client_addresses"`);
  }
}
