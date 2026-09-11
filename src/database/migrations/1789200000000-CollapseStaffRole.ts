import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Collapses the non-admin system roles (GROCER, KARDIST) into a single STAFF
 * tier. Post-RBAC they were labels that lied: non-admin access comes entirely
 * from assigned managed roles, and the enum only picked a starting template.
 *
 * Order matters: invitations are backfilled BEFORE the enum swap removes the
 * old labels, and the direct-jump permission is granted to the grocer base
 * role in the same transaction so no deploy window loses the capability.
 */
export class CollapseStaffRole1789200000000 implements MigrationInterface {
  name = 'CollapseStaffRole1789200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Invitations now carry the managed roles the webhook will assign.
    await queryRunner.query(
      `ALTER TABLE "invitations" ADD COLUMN IF NOT EXISTS "role_ids" uuid[] NOT NULL DEFAULT '{}'`,
    );

    // 2. In-flight pending invitations keep their intended access: map the
    //    old enum value to its seeded base role (join form: a missing base
    //    role updates 0 rows instead of writing nulls).
    await queryRunner.query(
      `UPDATE "invitations" i SET "role_ids" = ARRAY[r."id"]
         FROM "roles" r
        WHERE r."system_key" = 'GROCER'
          AND i."role"::text = 'GROCER'
          AND i."status" = 'pending'`,
    );
    await queryRunner.query(
      `UPDATE "invitations" i SET "role_ids" = ARRAY[r."id"]
         FROM "roles" r
        WHERE r."system_key" = 'KARDIST'
          AND i."role"::text = 'KARDIST'
          AND i."status" = 'pending'`,
    );

    // 3. Type-swap users_role_enum (ALTER TYPE ... ADD VALUE cannot be used in
    //    the same transaction it's added; a swap is fully transactional).
    await queryRunner.query(
      `CREATE TYPE "public"."users_role_enum_new" AS ENUM('SUPER_ADMIN', 'ADMIN', 'STAFF')`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ALTER COLUMN "role" TYPE "public"."users_role_enum_new"
        USING (CASE "role"::text WHEN 'GROCER' THEN 'STAFF' WHEN 'KARDIST' THEN 'STAFF' ELSE "role"::text END)::"public"."users_role_enum_new"`,
    );
    await queryRunner.query(`DROP TYPE "public"."users_role_enum"`);
    await queryRunner.query(
      `ALTER TYPE "public"."users_role_enum_new" RENAME TO "users_role_enum"`,
    );

    // 4. Same swap for invitations_role_enum.
    await queryRunner.query(
      `CREATE TYPE "public"."invitations_role_enum_new" AS ENUM('SUPER_ADMIN', 'ADMIN', 'STAFF')`,
    );
    await queryRunner.query(
      `ALTER TABLE "invitations" ALTER COLUMN "role" TYPE "public"."invitations_role_enum_new"
        USING (CASE "role"::text WHEN 'GROCER' THEN 'STAFF' WHEN 'KARDIST' THEN 'STAFF' ELSE "role"::text END)::"public"."invitations_role_enum_new"`,
    );
    await queryRunner.query(`DROP TYPE "public"."invitations_role_enum"`);
    await queryRunner.query(
      `ALTER TYPE "public"."invitations_role_enum_new" RENAME TO "invitations_role_enum"`,
    );

    // 5. Direct-jump becomes a grantable permission. Inserted here (not just
    //    boot-seeded) so the grant below can reference it; the boot diff-seeder
    //    sees an identical (module, action) row and skips it.
    await queryRunner.query(
      `INSERT INTO "permissions" ("module", "action", "description", "is_active")
       VALUES ('orders', 'update-status-direct', 'update-status-direct orders', true)
       ON CONFLICT ("module", "action") DO NOTHING`,
    );

    // 6. Grocers direct-jumped before the collapse; their base role keeps it.
    await queryRunner.query(
      `INSERT INTO "role_permissions" ("role_id", "permission_id")
       SELECT r."id", p."id"
         FROM "roles" r
         JOIN "permissions" p
           ON p."module" = 'orders' AND p."action" = 'update-status-direct'
        WHERE r."system_key" = 'GROCER'
       ON CONFLICT DO NOTHING`,
    );
  }

  public async down(): Promise<void> {
    // Irreversible: which STAFF user was a GROCER vs a KARDIST is lost by the
    // collapse. Restore from a backup instead of running this down.
  }
}
