import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddFulfillment1787689673368 implements MigrationInterface {
  name = 'AddFulfillment1787689673368';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "delivery_option_zones" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "option_id" uuid NOT NULL, "province_id" uuid NOT NULL, "municipality_id" uuid, "created_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_7a75452eb596b7736a939afd964" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_52c633c79f34b8c6fed6cacb93" ON "delivery_option_zones"  ("option_id") `,
    );
    await queryRunner.query(
      `CREATE TABLE "delivery_options" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "label" character varying(100) NOT NULL, "description" text, "fee" numeric(12,2) NOT NULL DEFAULT '0', "sort_order" integer NOT NULL DEFAULT '0', "enabled" boolean NOT NULL DEFAULT false, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP, CONSTRAINT "PK_b6481383fa7e6a8422d167adad1" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "fulfillment_settings" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "data" jsonb NOT NULL, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_03e5e6c924af6825d8a73a1097e" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `ALTER TABLE "orders" ADD "fulfillment_type" character varying(10) NOT NULL DEFAULT 'delivery'`,
    );
    await queryRunner.query(
      `ALTER TABLE "orders" ADD "delivery_option_id" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "orders" ADD "delivery_option_label" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "orders" ADD "pickup_location_id" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "orders" ADD "pickup_address_id" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "orders" ADD "pickup_address_snapshot" jsonb`,
    );
    // Everything that existed before this feature was a delivery; the column
    // default covers new rows, this covers the ones already there.
    await queryRunner.query(
      `UPDATE "orders" SET "fulfillment_type" = 'delivery' WHERE "fulfillment_type" IS NULL`,
    );
    // Pickup on, catalogue empty: the state the business is actually in.
    await queryRunner.query(
      `INSERT INTO "fulfillment_settings" ("data") VALUES ('{"pickupEnabled": true, "supportMessage": "Por el momento no podemos procesar pedidos en línea. Escribinos y coordinamos tu compra."}'::jsonb)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "orders" DROP COLUMN "pickup_address_snapshot"`,
    );
    await queryRunner.query(
      `ALTER TABLE "orders" DROP COLUMN "pickup_address_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "orders" DROP COLUMN "pickup_location_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "orders" DROP COLUMN "delivery_option_label"`,
    );
    await queryRunner.query(
      `ALTER TABLE "orders" DROP COLUMN "delivery_option_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "orders" DROP COLUMN "fulfillment_type"`,
    );
    await queryRunner.query(`DROP TABLE "fulfillment_settings"`);
    await queryRunner.query(`DROP TABLE "delivery_options"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_52c633c79f34b8c6fed6cacb93"`,
    );
    await queryRunner.query(`DROP TABLE "delivery_option_zones"`);
  }
}
