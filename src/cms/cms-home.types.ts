import type { CmsBannerTargetType } from './cms-banner.types';
import type { BannerAsset } from './entities/cms-banner.entity';

/**
 * Home sections the storefront knows how to render. The enum order is the
 * historical hardcoded order, so it doubles as the default layout.
 */
export enum HomeSectionKey {
  HERO = 'hero',
  DEPARTMENTS = 'departments',
  FEATURED_PRODUCTS = 'featured-products',
  SERVICES = 'services',
  ON_SALE_PRODUCTS = 'on-sale-products',
  CATEGORIES = 'categories',
  RECENT_PRODUCTS = 'recent-products',
}

export const HOME_SECTION_KEYS: readonly HomeSectionKey[] =
  Object.values(HomeSectionKey);

export interface HomeSection {
  key: HomeSectionKey;
  isVisible: boolean;
}

/**
 * What the editor changes directly. Empty featured lists mean «no curated
 * selection»: the storefront falls back to the products/departments flagged
 * as featured in the catalog.
 */
export interface HomeLayout {
  sections: HomeSection[];
  featuredProductIds: string[];
  featuredDepartmentIds: string[];
}

/**
 * A banner frozen at publish time. It is a copy, not a reference: editing or
 * deleting the banner row afterwards must not reach the live store until the
 * next publish.
 */
export interface HomeBannerSnapshot {
  id: string;
  alt: string;
  title: string | null;
  subtitle: string | null;
  desktop: BannerAsset;
  tablet: BannerAsset;
  mobile: BannerAsset;
  targetType: CmsBannerTargetType | null;
  targetId: string | null;
}

/** The whole home as the storefront renders it: layout plus active banners. */
export interface HomeSnapshot extends HomeLayout {
  banners: HomeBannerSnapshot[];
}

export enum CmsHomeChangeAction {
  BANNER_CREATED = 'banner-created',
  BANNER_UPDATED = 'banner-updated',
  BANNER_DELETED = 'banner-deleted',
  LAYOUT_UPDATED = 'layout-updated',
  PUBLISHED = 'published',
}
