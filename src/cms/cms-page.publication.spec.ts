import { isBlankText, publicationStatusOf } from './cms-page.publication';
import type { CmsPage } from './entities/cms-page.entity';
import type { CmsPageVersion } from './entities/cms-page-version.entity';

const version = { title: 'Términos', content: '# Términos' } as CmsPageVersion;

const page = (overrides: Partial<CmsPage>): CmsPage =>
  ({
    title: 'Términos',
    content: '# Términos',
    publishedVersion: null,
    ...overrides,
  }) as CmsPage;

describe('publicationStatusOf', () => {
  it('a text that was never published is unpublished', () => {
    expect(publicationStatusOf(page({}))).toBe('unpublished');
  });

  it('a draft equal to what the store shows is published', () => {
    expect(publicationStatusOf(page({ publishedVersion: version }))).toBe(
      'published',
    );
  });

  it('a draft that differs from the store has pending changes', () => {
    expect(
      publicationStatusOf(
        page({ content: '# Términos nuevos', publishedVersion: version }),
      ),
    ).toBe('pending-changes');
    expect(
      publicationStatusOf(
        page({ title: 'Condiciones', publishedVersion: version }),
      ),
    ).toBe('pending-changes');
  });
});

describe('isBlankText', () => {
  it('treats whitespace-only Markdown as empty', () => {
    expect(isBlankText('')).toBe(true);
    expect(isBlankText(' \n\t ')).toBe(true);
    expect(isBlankText('Hola')).toBe(false);
  });
});
