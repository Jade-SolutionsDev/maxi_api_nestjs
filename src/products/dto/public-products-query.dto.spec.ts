import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { PublicProductsQueryDto } from './public-products-query.dto';

const P1 = '11111111-1111-4111-8111-111111111111';
const P2 = '22222222-2222-4222-8222-222222222222';

describe('PublicProductsQueryDto', () => {
  it('reads a comma-separated id list in the given order', async () => {
    const query = plainToInstance(PublicProductsQueryDto, {
      ids: `${P2}, ${P1}`,
    });

    await expect(validate(query)).resolves.toHaveLength(0);
    expect(query.ids).toEqual([P2, P1]);
  });

  it('rejects an id that is not a UUID', async () => {
    const query = plainToInstance(PublicProductsQueryDto, {
      ids: `${P1},not-a-uuid`,
    });

    await expect(validate(query)).resolves.toEqual([
      expect.objectContaining({ property: 'ids' }),
    ]);
  });

  it('treats an empty value as no filter', async () => {
    const query = plainToInstance(PublicProductsQueryDto, { ids: '' });

    await expect(validate(query)).resolves.toHaveLength(0);
    expect(query.ids).toBeUndefined();
  });
});
