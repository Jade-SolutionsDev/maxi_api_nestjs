/**
 * Cache-Control for the public taxonomy endpoints (categories, departments,
 * catalog tree). Semi-stable data: browsers/CDNs may reuse a response for
 * 5 minutes and serve it stale for another 10 while revalidating, so an admin
 * edit is visible within minutes without the API taking a hit per page view.
 * (Express's default weak ETags already make revalidations cheap 304s.)
 */
export const TAXONOMY_CACHE = 'public, max-age=300, stale-while-revalidate=600';
