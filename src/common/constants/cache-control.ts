/**
 * Cache-Control for the public taxonomy endpoints (categories, departments,
 * catalog tree). Semi-stable data: browsers/CDNs may reuse a response for
 * 5 minutes and serve it stale for another 10 while revalidating, so an admin
 * edit is visible within minutes without the API taking a hit per page view.
 * (Express's default weak ETags already make revalidations cheap 304s.)
 */
export const TAXONOMY_CACHE = 'public, max-age=300, stale-while-revalidate=600';

/**
 * Cache-Control for content that switches on and off by the clock (home
 * notices with start/end dates): a minute of reuse at most, so a notice
 * appears and disappears close to the time the editor chose.
 */
export const SCHEDULED_CONTENT_CACHE =
  'public, max-age=60, stale-while-revalidate=60';
