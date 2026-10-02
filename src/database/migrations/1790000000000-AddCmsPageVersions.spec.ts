import type { QueryRunner } from 'typeorm';
import { AddCmsPageVersions1790000000000 } from './1790000000000-AddCmsPageVersions';

describe('AddCmsPageVersions1790000000000', () => {
  const runner = () =>
    ({
      query: jest.fn().mockResolvedValue(undefined),
    }) as unknown as QueryRunner;

  const statements = (queryRunner: QueryRunner) =>
    (queryRunner.query as jest.Mock).mock.calls.map(([sql]) => sql as string);

  const find = (queryRunner: QueryRunner, fragment: string) =>
    statements(queryRunner).find((sql) => sql.includes(fragment))!;

  it('adds the draft, the schedule and the history tables', async () => {
    const queryRunner = runner();

    await new AddCmsPageVersions1790000000000().up(queryRunner);

    const sql = statements(queryRunner).join('\n');
    expect(sql).toContain(
      `ADD COLUMN "kind" character varying(20) NOT NULL DEFAULT 'page'`,
    );
    expect(sql).toContain('ADD COLUMN "starts_at" TIMESTAMP WITH TIME ZONE');
    expect(sql).toContain('ADD COLUMN "ends_at" TIMESTAMP WITH TIME ZONE');
    expect(sql).toContain(
      'ADD COLUMN "draft_updated_by" character varying(160)',
    );
    expect(sql).toContain('ADD COLUMN "published_version_id" uuid');
    expect(sql).toContain('CREATE TABLE "cms_page_versions"');
    expect(sql).toContain(
      'CREATE UNIQUE INDEX "IDX_cms_page_versions_page_version" ON "cms_page_versions" ("page_id", "version")',
    );
  });

  it('publishes what the store shows today as version 1, so the deploy changes nothing', async () => {
    const queryRunner = runner();

    await new AddCmsPageVersions1790000000000().up(queryRunner);

    const insert = find(queryRunner, 'INSERT INTO "cms_page_versions"');
    expect(insert).toContain("'Sistema'");
    expect(insert).toContain('"deleted_at" IS NULL');
    expect(insert).toContain(`btrim("content") <> ''`);

    const link = find(queryRunner, 'SET "published_version_id"');
    expect(link).toContain('v."version" = 1');
  });

  it('keeps the history when a page is deleted for good', async () => {
    const queryRunner = runner();

    await new AddCmsPageVersions1790000000000().up(queryRunner);

    expect(find(queryRunner, 'CREATE TABLE "cms_page_versions"')).toContain(
      'REFERENCES "cms_pages"("id") ON DELETE RESTRICT',
    );
  });

  it('lets the web manager edit and publish texts, and nobody else', async () => {
    const queryRunner = runner();

    await new AddCmsPageVersions1790000000000().up(queryRunner);

    const calls = (queryRunner.query as jest.Mock).mock.calls as [
      string,
      string[][]?,
    ][];
    const [catalog, params] = calls.find(([sql]) =>
      sql.includes('INSERT INTO "permissions"'),
    )!;
    expect(params![0]).toEqual([
      'list',
      'read',
      'create',
      'update',
      'delete',
      'publish',
    ]);
    expect(catalog).toContain('ON CONFLICT ("module", "action") DO NOTHING');

    const grant = find(queryRunner, 'INSERT INTO "role_permissions"');
    expect(grant).toContain(`r."system_key" = 'WEB_MANAGER'`);
    expect(grant).toContain('r."deleted_at" IS NULL');
    expect(grant).toContain(`p."module" = 'cms-pages'`);
    expect(grant).toContain('ON CONFLICT DO NOTHING');
  });

  it('removes everything it added on the way down', async () => {
    const queryRunner = runner();

    await new AddCmsPageVersions1790000000000().down(queryRunner);

    const sql = statements(queryRunner).join('\n');
    expect(sql).toContain(
      'DROP CONSTRAINT IF EXISTS "FK_cms_pages_published_version"',
    );
    expect(sql).toContain('DROP TABLE IF EXISTS "cms_page_versions"');
    expect(sql).toContain('DROP COLUMN IF EXISTS "kind"');
    expect(sql).toContain('DROP COLUMN IF EXISTS "published_version_id"');
    expect(sql).toContain(`"action" = 'publish'`);
  });
});
