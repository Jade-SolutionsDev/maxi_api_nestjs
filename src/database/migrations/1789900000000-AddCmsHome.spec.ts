import type { QueryRunner } from 'typeorm';
import { AddCmsHome1789900000000 } from './1789900000000-AddCmsHome';

describe('AddCmsHome1789900000000', () => {
  const runner = () =>
    ({
      query: jest.fn().mockResolvedValue(undefined),
    }) as unknown as QueryRunner;

  const statements = (queryRunner: QueryRunner) =>
    (queryRunner.query as jest.Mock).mock.calls.map(([sql]) => sql as string);

  it('adds the banner text and the tables for the draft, the live copy and the log', async () => {
    const queryRunner = runner();

    await new AddCmsHome1789900000000().up(queryRunner);

    const sql = statements(queryRunner).join('\n');
    expect(sql).toContain('ADD COLUMN "title" character varying(80)');
    expect(sql).toContain('ADD COLUMN "subtitle" character varying(160)');
    expect(sql).toContain('CREATE TABLE "cms_home"');
    expect(sql).toContain('CREATE TABLE "cms_home_changes"');
  });

  it('publishes the banners that are live today, so the deploy changes nothing on the store', async () => {
    const queryRunner = runner();

    await new AddCmsHome1789900000000().up(queryRunner);

    const calls = (queryRunner.query as jest.Mock).mock.calls as [
      string,
      string[]?,
    ][];
    const [insert, params] = calls.find(([sql]) =>
      sql.includes('INSERT INTO "cms_home"'),
    )!;
    expect(insert).toContain('b.is_active AND b.deleted_at IS NULL');
    expect(insert).toContain('ORDER BY b.sort_order, b.created_at');
    expect(insert).toContain('WHERE NOT EXISTS');

    const layout = JSON.parse(params![0]) as {
      sections: { key: string; isVisible: boolean }[];
      featuredProductIds: string[];
    };
    expect(layout.sections.map((s) => s.key)).toEqual([
      'hero',
      'departments',
      'featured-products',
      'services',
      'on-sale-products',
      'categories',
      'recent-products',
    ]);
    expect(layout.sections.every((s) => s.isVisible)).toBe(true);
    expect(layout.featuredProductIds).toEqual([]);
  });

  it('removes everything it added on the way down', async () => {
    const queryRunner = runner();

    await new AddCmsHome1789900000000().down(queryRunner);

    const sql = statements(queryRunner).join('\n');
    expect(sql).toContain('DROP TABLE IF EXISTS "cms_home_changes"');
    expect(sql).toContain('DROP TABLE IF EXISTS "cms_home"');
    expect(sql).toContain('DROP COLUMN IF EXISTS "title"');
    expect(sql).toContain('DROP COLUMN IF EXISTS "subtitle"');
  });
});
