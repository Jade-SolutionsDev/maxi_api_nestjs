import type { CmsPage } from './entities/cms-page.entity';

/**
 * Where a text stands for the backoffice list: never published, the store
 * shows exactly the draft, or the draft has edits the store does not show.
 */
export type CmsPagePublicationStatus =
  | 'unpublished'
  | 'published'
  | 'pending-changes';

export const isBlankText = (markdown: string): boolean =>
  markdown.trim().length === 0;

export const publicationStatusOf = (
  page: Pick<CmsPage, 'title' | 'content' | 'publishedVersion'>,
): CmsPagePublicationStatus => {
  const published = page.publishedVersion;
  if (!published) return 'unpublished';
  return published.title === page.title && published.content === page.content
    ? 'published'
    : 'pending-changes';
};
