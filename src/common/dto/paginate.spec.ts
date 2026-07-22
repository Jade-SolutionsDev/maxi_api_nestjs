import { paginate } from './paginated.dto';

describe('paginate', () => {
  const items = [1, 2, 3, 4, 5];

  it('returns everything on one page when no limit is given', () => {
    expect(paginate(items)).toEqual({
      items,
      total: 5,
      page: 1,
      limit: null,
      totalPages: 1,
    });
  });

  it('slices the requested page and reports total/totalPages', () => {
    expect(paginate(items, 1, 2)).toEqual({
      items: [1, 2],
      total: 5,
      page: 1,
      limit: 2,
      totalPages: 3,
    });
    expect(paginate(items, 2, 2).items).toEqual([3, 4]);
    expect(paginate(items, 3, 2).items).toEqual([5]);
  });

  it('returns an empty page past the end (total stays correct)', () => {
    const result = paginate(items, 99, 2);
    expect(result.items).toEqual([]);
    expect(result.total).toBe(5);
    expect(result.totalPages).toBe(3);
  });

  it('handles an empty list', () => {
    expect(paginate([])).toMatchObject({ items: [], total: 0, totalPages: 0 });
    expect(paginate([], 1, 10)).toMatchObject({ total: 0, totalPages: 0 });
  });
});
