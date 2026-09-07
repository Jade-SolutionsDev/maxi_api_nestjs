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

export interface CmsBannerView {
  banner: CmsBanner;
  target: CmsBannerResolvedTarget | null;
}
