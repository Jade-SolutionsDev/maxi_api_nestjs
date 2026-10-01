import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { DEFAULT_HOME_LAYOUT } from '../cms-home.layout';
import { UpdateCmsHomeLayoutDto } from './cms-home.dto';

const P1 = '11111111-1111-4111-8111-111111111111';

describe('UpdateCmsHomeLayoutDto', () => {
  it('accepts known sections and UUID selections', async () => {
    const dto = plainToInstance(UpdateCmsHomeLayoutDto, {
      ...DEFAULT_HOME_LAYOUT,
      featuredProductIds: [P1],
      featuredDepartmentIds: [P1],
    });

    await expect(validate(dto)).resolves.toHaveLength(0);
  });

  it('rejects a section the storefront cannot render', async () => {
    const dto = plainToInstance(UpdateCmsHomeLayoutDto, {
      ...DEFAULT_HOME_LAYOUT,
      sections: [{ key: 'newsletter', isVisible: true }],
    });

    await expect(validate(dto)).resolves.toEqual([
      expect.objectContaining({ property: 'sections' }),
    ]);
  });

  it('rejects ids that are not UUIDs', async () => {
    const dto = plainToInstance(UpdateCmsHomeLayoutDto, {
      ...DEFAULT_HOME_LAYOUT,
      featuredProductIds: ['arroz'],
    });

    await expect(validate(dto)).resolves.toEqual([
      expect.objectContaining({ property: 'featuredProductIds' }),
    ]);
  });

  it('caps the curated products at what the home shows', async () => {
    const ids = Array.from(
      { length: 25 },
      (_, index) =>
        `11111111-1111-4111-8111-${String(index).padStart(12, '0')}`,
    );
    const dto = plainToInstance(UpdateCmsHomeLayoutDto, {
      ...DEFAULT_HOME_LAYOUT,
      featuredProductIds: ids,
    });

    await expect(validate(dto)).resolves.toEqual([
      expect.objectContaining({ property: 'featuredProductIds' }),
    ]);
  });
});
