import { Throttle } from '@nestjs/throttler';

/**
 * Strict rate limit for the storefront-mirror endpoint: a handful of requests
 * per minute per client IP. (Clerk webhooks are deliberately NOT strict-limited
 * — Clerk can burst several events at once and the signature is their gate.)
 */
export const StrictThrottle = () =>
  Throttle({ default: { ttl: 60_000, limit: 6 } });
