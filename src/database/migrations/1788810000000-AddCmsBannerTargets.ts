import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCmsBannerTargets1788810000000 implements MigrationInterface {
  name = 'AddCmsBannerTargets1788810000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "cms_banners" ADD COLUMN "target_type" varchar(20)`,
    );
    await queryRunner.query(
      `ALTER TABLE "cms_banners" ADD COLUMN "target_id" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "cms_banners"
         ADD CONSTRAINT "CK_cms_banners_target_pair"
         CHECK (("target_type" IS NULL) = ("target_id" IS NULL))`,
    );
    await queryRunner.query(
      `ALTER TABLE "cms_banners"
         ADD CONSTRAINT "CK_cms_banners_target_type"
         CHECK ("target_type" IS NULL OR "target_type" IN ('department', 'category', 'product'))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_cms_banners_target"
         ON "cms_banners" ("target_type", "target_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_cms_banners_target"`);
    await queryRunner.query(
      `ALTER TABLE "cms_banners" DROP CONSTRAINT "CK_cms_banners_target_type"`,
    );
    await queryRunner.query(
      `ALTER TABLE "cms_banners" DROP CONSTRAINT "CK_cms_banners_target_pair"`,
    );
    await queryRunner.query(
      `ALTER TABLE "cms_banners" DROP COLUMN "target_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "cms_banners" DROP COLUMN "target_type"`,
    );
  }
}
