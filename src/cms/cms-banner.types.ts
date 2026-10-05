import type { CmsBanner } from './entities/cms-banner.entity';

export enum CmsBannerTargetType {
  DEPARTMENT = 'department',
  CATEGORY = 'category',
  PRODUCT = 'product',
}

export interface CmsBannerTargetReference {
  type: CmsBannerTargetType;
  id: string;
}

export interface CmsBannerResolvedTarget extends CmsBannerTargetReference {
  name: string | null;
  slug: string | null;
  isAvailable: boolean;
}

/** Anything that can point at catalog content: a banner row or a published copy. */
export interface BannerTargetSource {
  targetType: CmsBannerTargetType | null;
  targetId: string | null;
}

export interface BannerView<T extends BannerTargetSource> {
  banner: T;
  target: CmsBannerResolvedTarget | null;
}

export type CmsBannerView = BannerView<CmsBanner>;
