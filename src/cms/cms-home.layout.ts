import { CmsBannerTargetType } from './cms-banner.types';
import {
  HOME_SECTION_KEYS,
  HomeBannerSnapshot,
  HomeLayout,
  HomeSection,
  HomeSectionKey,
  HomeSnapshot,
} from './cms-home.types';
import type { BannerAsset, CmsBanner } from './entities/cms-banner.entity';

/** What the store shows when nobody configured the home yet. */
export const DEFAULT_HOME_LAYOUT: HomeLayout = {
  sections: HOME_SECTION_KEYS.map((key) => ({ key, isVisible: true })),
  featuredProductIds: [],
  featuredDepartmentIds: [],
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isSectionKey = (value: unknown): value is HomeSectionKey =>
  HOME_SECTION_KEYS.includes(value as HomeSectionKey);

const uniqueStrings = (value: unknown): string[] =>
  Array.isArray(value)
    ? [...new Set(value.filter((item) => typeof item === 'string'))]
    : [];

/**
 * First occurrence of each known section wins; sections the document does not
 * mention (a section added to the storefront after the last save) are
 * appended visible, so a new section shows up instead of silently hiding.
 */
const normalizeSections = (value: unknown[]): HomeSection[] => {
  const seen = new Set<HomeSectionKey>();
  const sections: HomeSection[] = [];
  for (const item of value) {
    if (!isRecord(item) || !isSectionKey(item.key) || seen.has(item.key)) {
      continue;
    }
    seen.add(item.key);
    sections.push({ key: item.key, isVisible: item.isVisible !== false });
  }
  for (const key of HOME_SECTION_KEYS) {
    if (!seen.has(key)) sections.push({ key, isVisible: true });
  }
  return sections;
};

/**
 * Rebuilds a layout with a fixed shape. Everything read back from jsonb goes
 * through here: Postgres reorders object keys, so two equal documents only
 * compare equal once both were rebuilt the same way.
 */
export const normalizeHomeLayout = (value: unknown): HomeLayout => {
  if (!isRecord(value) || !Array.isArray(value.sections)) {
    return DEFAULT_HOME_LAYOUT;
  }
  return {
    sections: normalizeSections(value.sections),
    featuredProductIds: uniqueStrings(value.featuredProductIds),
    featuredDepartmentIds: uniqueStrings(value.featuredDepartmentIds),
  };
};

const toText = (value: unknown): string =>
  typeof value === 'string' ? value : '';

const toAsset = (value: unknown): BannerAsset => {
  const asset = isRecord(value) ? value : {};
  return {
    src: toText(asset.src),
    width: Number(asset.width ?? 0),
    height: Number(asset.height ?? 0),
  };
};

const toNullableString = (value: unknown): string | null =>
  typeof value === 'string' ? value : null;

const toTargetType = (value: unknown): CmsBannerTargetType | null =>
  Object.values(CmsBannerTargetType).includes(value as CmsBannerTargetType)
    ? (value as CmsBannerTargetType)
    : null;

const toBannerSnapshot = (
  banner: Pick<CmsBanner, keyof HomeBannerSnapshot> | Record<string, unknown>,
): HomeBannerSnapshot => ({
  id: toText(banner.id),
  alt: toText(banner.alt),
  title: toNullableString(banner.title),
  subtitle: toNullableString(banner.subtitle),
  desktop: toAsset(banner.desktop),
  tablet: toAsset(banner.tablet),
  mobile: toAsset(banner.mobile),
  targetType: toTargetType(banner.targetType),
  targetId: toNullableString(banner.targetId),
});

/** Freezes the layout and the given banner rows, in the order received. */
export const buildHomeSnapshot = (
  layout: HomeLayout,
  banners: CmsBanner[],
): HomeSnapshot => ({
  ...normalizeHomeLayout(layout),
  banners: banners.map(toBannerSnapshot),
});

export const layoutOf = (snapshot: HomeSnapshot): HomeLayout => ({
  sections: snapshot.sections,
  featuredProductIds: snapshot.featuredProductIds,
  featuredDepartmentIds: snapshot.featuredDepartmentIds,
});

export const normalizeHomeSnapshot = (value: unknown): HomeSnapshot | null => {
  if (!isRecord(value)) return null;
  return {
    ...normalizeHomeLayout(value),
    banners: Array.isArray(value.banners)
      ? value.banners.filter(isRecord).map(toBannerSnapshot)
      : [],
  };
};

export const sameHomeSnapshot = (
  a: HomeSnapshot,
  b: HomeSnapshot | null,
): boolean =>
  b !== null &&
  JSON.stringify(normalizeHomeSnapshot(a)) ===
    JSON.stringify(normalizeHomeSnapshot(b));
