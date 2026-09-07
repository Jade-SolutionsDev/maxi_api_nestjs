import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * RBAC revival groundwork:
 *
 * - `roles.system_key`: marks the seeded, editable base roles that replace the
 *   old hard-coded enum baselines (one per non-admin system role, e.g.
 *   'GROCER' → «Almacenero — base»). Partial-unique so at most one role per
 *   key while custom roles keep a NULL key.
 * - Unique (module, action) on `permissions`: the old seeder did sequential
 *   find-then-save with no constraint, so duplicates were possible under
 *   concurrent boots. Dedupe defensively (repointing role grants to the kept
 *   row), then add the index — it also backstops the new diff-seeder against
 *   multi-instance boot races.
 */
export class RbacManagedCatalog1789000000000 implements MigrationInterface {
  name = 'RbacManagedCatalog1789000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "roles" ADD COLUMN IF NOT EXISTS "system_key" character varying(50)`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_roles_system_key"
         ON "roles" ("system_key") WHERE "system_key" IS NOT NULL`,
    );

    // Dedupe permissions per (module, action), keeping the smallest id.
    // 1. Repoint role grants from duplicates to the keeper (skip collisions).
    await queryRunner.query(
      `UPDATE "role_permissions" rp
          SET "permission_id" = k."keep_id"
         FROM (
           SELECT p."id",
                  (MIN(p."id"::text) OVER (PARTITION BY p."module", p."action"))::uuid AS "keep_id"
             FROM "permissions" p
         ) k
        WHERE rp."permission_id" = k."id"
          AND k."id" <> k."keep_id"
          AND NOT EXISTS (
            SELECT 1 FROM "role_permissions" x
             WHERE x."role_id" = rp."role_id" AND x."permission_id" = k."keep_id"
          )`,
    );
    // 2. Drop leftover duplicate grants still pointing at a non-keeper row.
    await queryRunner.query(
      `DELETE FROM "role_permissions" rp
        USING (
          SELECT p."id",
                 (MIN(p."id"::text) OVER (PARTITION BY p."module", p."action"))::uuid AS "keep_id"
            FROM "permissions" p
        ) k
        WHERE rp."permission_id" = k."id" AND k."id" <> k."keep_id"`,
    );
    // 3. Drop the duplicate permission rows themselves.
    await queryRunner.query(
      `DELETE FROM "permissions" p
        USING (
          SELECT p2."id",
                 (MIN(p2."id"::text) OVER (PARTITION BY p2."module", p2."action"))::uuid AS "keep_id"
            FROM "permissions" p2
        ) k
        WHERE p."id" = k."id" AND k."id" <> k."keep_id"`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_permissions_module_action"
         ON "permissions" ("module", "action")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "UQ_permissions_module_action"`,
    );
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_roles_system_key"`);
    await queryRunner.query(
      `ALTER TABLE "roles" DROP COLUMN IF EXISTS "system_key"`,
    );
  }
}
