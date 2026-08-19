import { Throttle } from '@nestjs/throttler';

/**
 * Strict rate limit for unauthenticated, abuse-prone endpoints (the storefront
 * mirror and the Clerk webhooks): a handful of requests per minute per IP.
 */
export const StrictThrottle = () =>
  Throttle({ default: { ttl: 60_000, limit: 6 } });
