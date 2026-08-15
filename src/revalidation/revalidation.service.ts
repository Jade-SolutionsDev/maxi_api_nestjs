import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { StorefrontConfig } from '../config/configuration';

/** Storefront cache tags invalidated by taxonomy (category/department) writes. */
export const TAXONOMY_REVALIDATE_TAGS = ['taxonomy', 'taxonomy-tree'];

/** Storefront cache tags invalidated by storage-location/coverage writes. */
export const LOCATION_REVALIDATE_TAGS = ['location-catalog'];

/**
 * Storefront cache tags invalidated by admin product writes. Product changes
 * reach beyond product lists: a category is publicly "valid" only while it has
 * at least one active in-stock product, so the taxonomy payloads shift too.
 */
export const PRODUCT_REVALIDATE_TAGS = [
  'taxonomy',
  'taxonomy-tree',
  'product-list',
];

/**
 * Pings the storefront's POST /api/revalidate so its cached data ('use cache'
 * tags) refreshes right after an admin write instead of waiting out the TTL.
 *
 * Fire-and-forget on purpose: an admin write must never fail or slow down
 * because the storefront is unreachable, so failures are logged and swallowed.
 * Disabled unless STOREFRONT_URL and STOREFRONT_REVALIDATE_SECRET are set.
 */
@Injectable()
export class RevalidationService {
  private readonly logger = new Logger(RevalidationService.name);

  constructor(private readonly configService: ConfigService) {}

  notify(tags: string[]): void {
    const storefront = this.configService.get<StorefrontConfig>('storefront');

    if (!storefront?.url || !storefront.revalidateSecret) {
      return;
    }

    void fetch(`${storefront.url}/api/revalidate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-revalidate-secret': storefront.revalidateSecret,
      },
      body: JSON.stringify({ tags }),
      signal: AbortSignal.timeout(5000),
    })
      .then((res) => {
        if (!res.ok) {
          this.logger.warn(
            `Storefront revalidation of [${tags.join(', ')}] failed: HTTP ${res.status}`,
          );
        }
      })
      .catch((err: Error) => {
        this.logger.warn(
          `Storefront revalidation of [${tags.join(', ')}] failed: ${err.message}`,
        );
      });
  }
}
