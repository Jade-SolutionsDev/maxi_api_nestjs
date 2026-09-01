import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Baseline: the whole schema as of 24-ago-2026, generated with
 * `migration:generate` against an empty database and then made idempotent.
 *
 * Why idempotent: production already has these 30 tables — created by
 * `synchronize` back when this project had no migrations at all. (The 31st,
 * `migrations`, is TypeORM's own bookkeeping.) A plain CREATE would
 * fail there. `IF NOT EXISTS` (and the DO blocks for enums and foreign keys,
 * which do not support it) let the same migration serve both an empty database
 * and one that already carries the schema, with no manual step in production.
 *
 * It also absorbs the earlier CreateClientAddresses migration, which is why
 * that file is gone: this one creates that table too.
 */

export class InitialSchema1787500000000 implements MigrationInterface {
  name = 'InitialSchema1787500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "categories" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "parent_id" uuid, "name" character varying(100) NOT NULL, "slug" character varying(100) NOT NULL, "description" text, "image_desktop_url" text, "image_mobile_url" text, "is_featured" boolean NOT NULL DEFAULT false, "sort_order" integer NOT NULL DEFAULT '0', "is_active" boolean NOT NULL DEFAULT true, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP, CONSTRAINT "PK_24dbc6126a28ff948da33e97d3b" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_420d9f679d41281f282f5bc7d0" ON "categories"  ("slug") `,
    );
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "products" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "category_id" uuid NOT NULL, "sku" character varying(100) NOT NULL, "name" character varying(255) NOT NULL, "slug" character varying(255) NOT NULL, "description" text, "image_url" text, "format" character varying(100), "expiry_date" date, "measure_unit" character varying(50) NOT NULL DEFAULT 'unidad', "base_price" numeric(12,2) NOT NULL, "discount" numeric(5,2) NOT NULL DEFAULT '0', "is_featured" boolean NOT NULL DEFAULT false, "sort_order" integer NOT NULL DEFAULT '0', "is_active" boolean NOT NULL DEFAULT true, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP, CONSTRAINT "PK_0806c755e0aca124e67c0cf6d7d" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_464f927ae360106b783ed0b410" ON "products"  ("slug") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_c44ac33a05b144dd0d9ddcf932" ON "products"  ("sku") `,
    );
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "cart_items" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "client_id" uuid NOT NULL, "product_id" uuid NOT NULL, "quantity" integer NOT NULL, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_6fccf5ec03c172d27a28a82928b" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_af0b456dba8170f57eb7505a2a" ON "cart_items"  ("client_id", "product_id") `,
    );
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "client_addresses" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "client_id" uuid NOT NULL, "label" character varying(100), "street" character varying(300) NOT NULL, "between_streets" character varying(200), "reference" text, "municipality_id" uuid NOT NULL, "contact_phone" character varying(20), "is_default" boolean NOT NULL DEFAULT false, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP, CONSTRAINT "PK_1df84115ce2e00312a3cca277e9" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_a88557f9d4f0eebd10e1c46af7" ON "client_addresses"  ("client_id") `,
    );
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "clients" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "clerk_id" character varying(255) NOT NULL, "email" character varying(255), "firstName" character varying(100), "lastName" character varying(100), "phone" character varying(20), "avatar_url" text, "default_municipality_id" uuid, "is_active" boolean NOT NULL DEFAULT true, "admin_invite_pending" boolean NOT NULL DEFAULT false, "onboarding_completed" boolean NOT NULL DEFAULT false, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP, CONSTRAINT "UQ_eb187a1284d7ef0cedff768cc04" UNIQUE ("clerk_id"), CONSTRAINT "UQ_b48860677afe62cd96e12659482" UNIQUE ("email"), CONSTRAINT "UQ_eb187a1284d7ef0cedff768cc04" UNIQUE ("clerk_id"), CONSTRAINT "UQ_b48860677afe62cd96e12659482" UNIQUE ("email"), CONSTRAINT "PK_f1ab7cf3a5714dbc6bb4e1c28a4" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "cms_banners" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "alt" character varying(160) NOT NULL, "desktop" jsonb NOT NULL, "tablet" jsonb NOT NULL, "mobile" jsonb NOT NULL, "sort_order" integer NOT NULL DEFAULT '0', "is_active" boolean NOT NULL DEFAULT true, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP, CONSTRAINT "PK_ea6961bbc639ded31606c57c5bf" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "cms_pages" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "slug" character varying(120) NOT NULL, "title" character varying(160) NOT NULL, "content" text NOT NULL, "sort_order" integer NOT NULL DEFAULT '0', "is_active" boolean NOT NULL DEFAULT true, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP, CONSTRAINT "PK_a6bd4d97252f8f122d34bc6bce6" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_164bf011d905e86e677bc86a1e" ON "cms_pages"  ("slug") `,
    );
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "cms_services" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "icon" character varying(60) NOT NULL, "title" character varying(120) NOT NULL, "description" text NOT NULL, "is_featured" boolean NOT NULL DEFAULT false, "sort_order" integer NOT NULL DEFAULT '0', "is_active" boolean NOT NULL DEFAULT true, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP, CONSTRAINT "PK_e4cf5f2b16ce0a4d90923ad97a4" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "cms_site_settings" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "data" jsonb NOT NULL, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_f3796bb59096485c9bb8c4d3796" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "cms_staff_members" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "name" character varying(120) NOT NULL, "role" character varying(120) NOT NULL, "photo_url" text, "resume" text, "sort_order" integer NOT NULL DEFAULT '0', "is_active" boolean NOT NULL DEFAULT true, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP, CONSTRAINT "PK_5b4222dc728414768f1a21c385d" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "municipalities" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "province_id" uuid NOT NULL, "name" character varying(100) NOT NULL, "code" character varying(10) NOT NULL, "is_active" boolean NOT NULL DEFAULT true, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_9c4573349577306f221dda4d924" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_9d540866f82ef14e8fa8ea5e25" ON "municipalities"  ("province_id") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_9e0e960d7323bb120dc5e915dd" ON "municipalities"  ("code") `,
    );
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "provinces" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "name" character varying(100) NOT NULL, "code" character varying(10) NOT NULL, "is_active" boolean NOT NULL DEFAULT true, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_2e4260eedbcad036ec53222e0c7" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_5c78199072262966fb68b71809" ON "provinces"  ("name") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_f4b684af62d5cb3aa174f6b9b8" ON "provinces"  ("code") `,
    );
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "inventory_operation_items" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "operation_id" uuid NOT NULL, "product_id" uuid NOT NULL, "quantity" integer NOT NULL, CONSTRAINT "PK_19c637b794c2e31995605a2b70a" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_d4ce822891c5f5b98ed493bb4d" ON "inventory_operation_items"  ("operation_id") `,
    );
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "inventory_operations" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "type" character varying(20) NOT NULL, "location_id" uuid NOT NULL, "target_location_id" uuid, "order_id" uuid, "note" character varying(500), "created_by" uuid NOT NULL, "created_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_e3d09da79ea4750103c31b36500" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_52956f4ce91674385b682c90c9" ON "inventory_operations"  ("order_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_ff1e44c99281d0379350327262" ON "inventory_operations"  ("location_id") `,
    );
    await queryRunner.query(
      `DO $$ BEGIN CREATE TYPE "public"."inventory_reservations_status_enum" AS ENUM('reserved', 'confirmed', 'cancelled'); EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
    );
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "inventory_reservations" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "order_id" uuid NOT NULL, "location_id" uuid NOT NULL, "product_id" uuid NOT NULL, "quantity" integer NOT NULL, "status" "public"."inventory_reservations_status_enum" NOT NULL DEFAULT 'reserved', "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_af438c0ce596eea6c4d472a0489" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_f18e859e07c6a1a4f335088649" ON "inventory_reservations"  ("order_id") `,
    );
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "inventory" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "location_id" uuid NOT NULL, "product_id" uuid NOT NULL, "quantity" integer NOT NULL DEFAULT '0', "reserved_quantity" integer NOT NULL DEFAULT '0', "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_82aa5da437c5bbfb80703b08309" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_a51c510e8ff4ee67d9376d8851" ON "inventory"  ("location_id", "product_id") `,
    );
    await queryRunner.query(
      `DO $$ BEGIN CREATE TYPE "public"."orders_status_enum" AS ENUM('pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled'); EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
    );
    await queryRunner.query(
      `DO $$ BEGIN CREATE TYPE "public"."orders_payment_status_enum" AS ENUM('pending', 'paid', 'failed', 'refunded'); EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
    );
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "orders" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "order_number" character varying(20), "seq" SERIAL NOT NULL, "client_id" uuid NOT NULL, "status" "public"."orders_status_enum" NOT NULL DEFAULT 'pending', "payment_status" "public"."orders_payment_status_enum" NOT NULL DEFAULT 'pending', "payment_ref" character varying(255), "subtotal" numeric(12,2) NOT NULL, "delivery_fee" numeric(12,2) NOT NULL DEFAULT '0', "total" numeric(12,2) NOT NULL, "delivery_municipality_id" uuid, "delivery_address" jsonb, "customer_notes" text, "cancellation_reason" character varying(40), "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP, CONSTRAINT "UQ_75eba1c6b1a66b09f2a97e6927b" UNIQUE ("order_number"), CONSTRAINT "PK_710e2d4957aa5878dfe94e4ac2f" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_505ba3689ef2763acd6c4fc93a" ON "orders"  ("client_id") `,
    );
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "order_items" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "order_id" uuid NOT NULL, "product_id" uuid NOT NULL, "product_name_snapshot" character varying(255) NOT NULL, "unit_price" numeric(12,2) NOT NULL, "quantity" integer NOT NULL, "line_total" numeric(12,2) NOT NULL, "created_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_005269d8574e6fac0493715c308" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_145532db85752b29c57d2b7b1f" ON "order_items"  ("order_id") `,
    );
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "payment_charges" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "order_id" uuid NOT NULL, "provider" character varying(32) NOT NULL DEFAULT 'mibilletera', "reference" character varying(64) NOT NULL, "idempotency_key" character varying(128) NOT NULL, "status" character varying(32) NOT NULL, "amount" numeric(20,8) NOT NULL, "fee_amount" numeric(20,8), "settlement_amount" numeric(20,8), "currency" character varying(10) NOT NULL, "action_payload" jsonb, "redirect_url" text, "last_payload" jsonb, "error_message" text, "expires_at" TIMESTAMP WITH TIME ZONE, "completed_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_0882bdf69aa7e86c08083f97bf4" UNIQUE ("reference"), CONSTRAINT "PK_dc6b89ab2d47e5edbe810edd696" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_590110bacb407498d76ef9880f" ON "payment_charges"  ("order_id") `,
    );
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "payment_methods" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "code" character varying(32) NOT NULL, "label" character varying(80) NOT NULL, "description" text, "icon" character varying(40), "sort_order" integer NOT NULL DEFAULT '0', "enabled" boolean NOT NULL DEFAULT false, "config" jsonb, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_f8aad3eab194dfdae604ca11125" UNIQUE ("code"), CONSTRAINT "PK_34f9b8c6dfb4ac3559f7e2820d1" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "permissions" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "module" character varying(50) NOT NULL, "action" character varying(50) NOT NULL, "description" text, "is_active" boolean NOT NULL DEFAULT true, CONSTRAINT "PK_920331560282b8bd21bb02290df" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "roles" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "name" character varying(100) NOT NULL, "description" text, "is_system" boolean NOT NULL DEFAULT false, "is_active" boolean NOT NULL DEFAULT true, "created_by" uuid, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP, CONSTRAINT "PK_c1433d71a4838793a49dcad46ab" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "role_permissions" ("role_id" uuid NOT NULL, "permission_id" uuid NOT NULL, CONSTRAINT "PK_25d24010f53bb80b78e412c9656" PRIMARY KEY ("role_id", "permission_id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "user_roles" ("user_id" uuid NOT NULL, "role_id" uuid NOT NULL, "assigned_by" uuid, "assigned_at" TIMESTAMP NOT NULL DEFAULT NOW(), CONSTRAINT "PK_23ed6f04fe43066df08379fd034" PRIMARY KEY ("user_id", "role_id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "stock_location_coverage" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "location_id" uuid NOT NULL, "coverage_type" character varying(20) NOT NULL, "province_id" uuid NOT NULL, "municipality_id" uuid, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_26413460e955a50f7800c953e68" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_656952786bef1ee6d8d930f03a" ON "stock_location_coverage"  ("location_id", "province_id", "municipality_id") `,
    );
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "stock_location_grocers" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "location_id" uuid NOT NULL, "grocer_id" uuid NOT NULL, "created_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_43849bc978fdfac7df64d31000b" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_7b665cc7b6977eb7b10cad0f7a" ON "stock_location_grocers"  ("location_id", "grocer_id") `,
    );
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "stock_location_pickup_addresses" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "location_id" uuid NOT NULL, "label" character varying(100), "address" character varying(300) NOT NULL, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_e037440807bfe15802609103e5e" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "stock_locations" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "name" character varying(150) NOT NULL, "is_active" boolean NOT NULL DEFAULT true, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP, CONSTRAINT "PK_86370cc527e4982c542b286f11c" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `DO $$ BEGIN CREATE TYPE "public"."users_role_enum" AS ENUM('SUPER_ADMIN', 'ADMIN', 'GROCER', 'KARDIST'); EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
    );
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "users" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "clerk_id" character varying(255), "role" "public"."users_role_enum" NOT NULL, "email" character varying(255), "firstName" character varying(100), "lastName" character varying(100), "phone" character varying(20), "avatar_url" text, "business_name" character varying(200), "business_description" text, "business_logo_url" text, "clerk_org_id" character varying(255), "is_active" boolean NOT NULL DEFAULT true, "approved_at" TIMESTAMP, "created_by" uuid, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP, CONSTRAINT "UQ_bc7be2d54c239f9e1d8a5292117" UNIQUE ("clerk_id"), CONSTRAINT "UQ_97672ac88f789774dd47f7c8be3" UNIQUE ("email"), CONSTRAINT "UQ_0b235704eb0e357cbe0fd1c26a9" UNIQUE ("clerk_org_id"), CONSTRAINT "PK_a3ffb1c0c8416b9fc6f907b7433" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `DO $$ BEGIN CREATE TYPE "public"."invitations_role_enum" AS ENUM('SUPER_ADMIN', 'ADMIN', 'GROCER', 'KARDIST'); EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
    );
    await queryRunner.query(
      `DO $$ BEGIN CREATE TYPE "public"."invitations_status_enum" AS ENUM('pending', 'accepted', 'revoked'); EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
    );
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "invitations" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "email" character varying(255) NOT NULL, "role" "public"."invitations_role_enum" NOT NULL, "invited_by" uuid, "organization_id" character varying(255), "firstName" character varying(100), "lastName" character varying(100), "clerk_invitation_id" character varying(255), "status" "public"."invitations_status_enum" NOT NULL DEFAULT 'pending', "accepted_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_5dec98cfdfd562e4ad3648bbb07" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `DO $$ BEGIN ALTER TABLE "role_permissions" ADD CONSTRAINT "FK_178199805b901ccd220ab7740ec" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE NO ACTION; EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
    );
    await queryRunner.query(
      `DO $$ BEGIN ALTER TABLE "role_permissions" ADD CONSTRAINT "FK_17022daf3f885f7d35423e9971e" FOREIGN KEY ("permission_id") REFERENCES "permissions"("id") ON DELETE CASCADE ON UPDATE NO ACTION; EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
    );
    await queryRunner.query(
      `DO $$ BEGIN ALTER TABLE "user_roles" ADD CONSTRAINT "FK_b23c65e50a758245a33ee35fda1" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE NO ACTION; EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
    );
    await queryRunner.query(
      `DO $$ BEGIN ALTER TABLE "invitations" ADD CONSTRAINT "FK_29b1cef6891d9b9d4e35f793b81" FOREIGN KEY ("invited_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION; EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "invitations" DROP CONSTRAINT "FK_29b1cef6891d9b9d4e35f793b81"`,
    );
    await queryRunner.query(
      `ALTER TABLE "user_roles" DROP CONSTRAINT "FK_b23c65e50a758245a33ee35fda1"`,
    );
    await queryRunner.query(
      `ALTER TABLE "role_permissions" DROP CONSTRAINT "FK_17022daf3f885f7d35423e9971e"`,
    );
    await queryRunner.query(
      `ALTER TABLE "role_permissions" DROP CONSTRAINT "FK_178199805b901ccd220ab7740ec"`,
    );
    await queryRunner.query(`DROP TABLE "invitations"`);
    await queryRunner.query(`DROP TYPE "public"."invitations_status_enum"`);
    await queryRunner.query(`DROP TYPE "public"."invitations_role_enum"`);
    await queryRunner.query(`DROP TABLE "users"`);
    await queryRunner.query(`DROP TYPE "public"."users_role_enum"`);
    await queryRunner.query(`DROP TABLE "stock_locations"`);
    await queryRunner.query(`DROP TABLE "stock_location_pickup_addresses"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_7b665cc7b6977eb7b10cad0f7a"`,
    );
    await queryRunner.query(`DROP TABLE "stock_location_grocers"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_656952786bef1ee6d8d930f03a"`,
    );
    await queryRunner.query(`DROP TABLE "stock_location_coverage"`);
    await queryRunner.query(`DROP TABLE "user_roles"`);
    await queryRunner.query(`DROP TABLE "role_permissions"`);
    await queryRunner.query(`DROP TABLE "roles"`);
    await queryRunner.query(`DROP TABLE "permissions"`);
    await queryRunner.query(`DROP TABLE "payment_methods"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_590110bacb407498d76ef9880f"`,
    );
    await queryRunner.query(`DROP TABLE "payment_charges"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_145532db85752b29c57d2b7b1f"`,
    );
    await queryRunner.query(`DROP TABLE "order_items"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_505ba3689ef2763acd6c4fc93a"`,
    );
    await queryRunner.query(`DROP TABLE "orders"`);
    await queryRunner.query(`DROP TYPE "public"."orders_payment_status_enum"`);
    await queryRunner.query(`DROP TYPE "public"."orders_status_enum"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_a51c510e8ff4ee67d9376d8851"`,
    );
    await queryRunner.query(`DROP TABLE "inventory"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_f18e859e07c6a1a4f335088649"`,
    );
    await queryRunner.query(`DROP TABLE "inventory_reservations"`);
    await queryRunner.query(
      `DROP TYPE "public"."inventory_reservations_status_enum"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_ff1e44c99281d0379350327262"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_52956f4ce91674385b682c90c9"`,
    );
    await queryRunner.query(`DROP TABLE "inventory_operations"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_d4ce822891c5f5b98ed493bb4d"`,
    );
    await queryRunner.query(`DROP TABLE "inventory_operation_items"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_f4b684af62d5cb3aa174f6b9b8"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_5c78199072262966fb68b71809"`,
    );
    await queryRunner.query(`DROP TABLE "provinces"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_9e0e960d7323bb120dc5e915dd"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_9d540866f82ef14e8fa8ea5e25"`,
    );
    await queryRunner.query(`DROP TABLE "municipalities"`);
    await queryRunner.query(`DROP TABLE "cms_staff_members"`);
    await queryRunner.query(`DROP TABLE "cms_site_settings"`);
    await queryRunner.query(`DROP TABLE "cms_services"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_164bf011d905e86e677bc86a1e"`,
    );
    await queryRunner.query(`DROP TABLE "cms_pages"`);
    await queryRunner.query(`DROP TABLE "cms_banners"`);
    await queryRunner.query(`DROP TABLE "clients"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_a88557f9d4f0eebd10e1c46af7"`,
    );
    await queryRunner.query(`DROP TABLE "client_addresses"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_af0b456dba8170f57eb7505a2a"`,
    );
    await queryRunner.query(`DROP TABLE "cart_items"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_c44ac33a05b144dd0d9ddcf932"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_464f927ae360106b783ed0b410"`,
    );
    await queryRunner.query(`DROP TABLE "products"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_420d9f679d41281f282f5bc7d0"`,
    );
    await queryRunner.query(`DROP TABLE "categories"`);
  }
}
