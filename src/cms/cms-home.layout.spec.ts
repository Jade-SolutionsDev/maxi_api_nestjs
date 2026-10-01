import { CmsBannerTargetType } from './cms-banner.types';
import {
  buildHomeSnapshot,
  DEFAULT_HOME_LAYOUT,
  normalizeHomeLayout,
  normalizeHomeSnapshot,
  sameHomeSnapshot,
} from './cms-home.layout';
import { HomeSectionKey } from './cms-home.types';
import type { CmsBanner } from './entities/cms-banner.entity';

const P1 = '11111111-1111-4111-8111-111111111111';
const P2 = '22222222-2222-4222-8222-222222222222';

const makeBanner = (overrides: Partial<CmsBanner> = {}): CmsBanner => ({
  id: 'banner-1',
  alt: 'Oferta semanal',
  title: 'Todo para el hogar',
  subtitle: 'Hasta 20 % menos',
  desktop: { src: '/desktop.webp', width: 1600, height: 500 },
  tablet: { src: '/tablet.webp', width: 1024, height: 420 },
  mobile: { src: '/mobile.webp', width: 640, height: 480 },
  targetType: CmsBannerTargetType.DEPARTMENT,
  targetId: P1,
  sortOrder: 3,
  isActive: true,
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-02'),
  deletedAt: null,
  ...overrides,
});

describe('home layout', () => {
  it('defaults to every section visible, in the historical order', () => {
    expect(DEFAULT_HOME_LAYOUT).toEqual({
      sections: [
        { key: HomeSectionKey.HERO, isVisible: true },
        { key: HomeSectionKey.DEPARTMENTS, isVisible: true },
        { key: HomeSectionKey.FEATURED_PRODUCTS, isVisible: true },
        { key: HomeSectionKey.SERVICES, isVisible: true },
        { key: HomeSectionKey.ON_SALE_PRODUCTS, isVisible: true },
        { key: HomeSectionKey.CATEGORIES, isVisible: true },
        { key: HomeSectionKey.RECENT_PRODUCTS, isVisible: true },
      ],
      featuredProductIds: [],
      featuredDepartmentIds: [],
    });
  });

  it('keeps the editor order, drops unknown and repeated keys, and appends the missing sections', () => {
    const layout = normalizeHomeLayout({
      sections: [
        { key: HomeSectionKey.SERVICES, isVisible: false },
        { key: 'newsletter', isVisible: true },
        { key: HomeSectionKey.HERO, isVisible: true },
        { key: HomeSectionKey.SERVICES, isVisible: true },
      ],
      featuredProductIds: [],
      featuredDepartmentIds: [],
    });

    expect(layout.sections.map((section) => section.key)).toEqual([
      HomeSectionKey.SERVICES,
      HomeSectionKey.HERO,
      HomeSectionKey.DEPARTMENTS,
      HomeSectionKey.FEATURED_PRODUCTS,
      HomeSectionKey.ON_SALE_PRODUCTS,
      HomeSectionKey.CATEGORIES,
      HomeSectionKey.RECENT_PRODUCTS,
    ]);
    expect(layout.sections[0]).toEqual({
      key: HomeSectionKey.SERVICES,
      isVisible: false,
    });
    expect(layout.sections.slice(2).every((s) => s.isVisible)).toBe(true);
  });

  it('removes repeated featured ids without changing their order', () => {
    const layout = normalizeHomeLayout({
      sections: [],
      featuredProductIds: [P2, P1, P2],
      featuredDepartmentIds: [P1, P1],
    });

    expect(layout.featuredProductIds).toEqual([P2, P1]);
    expect(layout.featuredDepartmentIds).toEqual([P1]);
  });

  it('falls back to the default layout for a missing or malformed document', () => {
    expect(normalizeHomeLayout(null)).toEqual(DEFAULT_HOME_LAYOUT);
    expect(normalizeHomeLayout({ sections: 'hero' })).toEqual(
      DEFAULT_HOME_LAYOUT,
    );
  });
});

describe('home snapshot', () => {
  it('copies the banner content and leaves the row metadata out', () => {
    const snapshot = buildHomeSnapshot(DEFAULT_HOME_LAYOUT, [makeBanner()]);

    expect(snapshot.banners).toEqual([
      {
        id: 'banner-1',
        alt: 'Oferta semanal',
        title: 'Todo para el hogar',
        subtitle: 'Hasta 20 % menos',
        desktop: { src: '/desktop.webp', width: 1600, height: 500 },
        tablet: { src: '/tablet.webp', width: 1024, height: 420 },
        mobile: { src: '/mobile.webp', width: 640, height: 480 },
        targetType: CmsBannerTargetType.DEPARTMENT,
        targetId: P1,
      },
    ]);
    expect(snapshot.sections).toEqual(DEFAULT_HOME_LAYOUT.sections);
  });

  it('reads back a published document whose keys came out of the database reordered', () => {
    const snapshot = buildHomeSnapshot(DEFAULT_HOME_LAYOUT, [makeBanner()]);
    const reordered: unknown = {
      featuredDepartmentIds: [],
      banners: [
        {
          targetId: P1,
          mobile: { height: 480, src: '/mobile.webp', width: 640 },
          tablet: { height: 420, width: 1024, src: '/tablet.webp' },
          desktop: { width: 1600, height: 500, src: '/desktop.webp' },
          subtitle: 'Hasta 20 % menos',
          title: 'Todo para el hogar',
          targetType: CmsBannerTargetType.DEPARTMENT,
          alt: 'Oferta semanal',
          id: 'banner-1',
        },
      ],
      sections: snapshot.sections.map(({ key, isVisible }) => ({
        isVisible,
        key,
      })),
      featuredProductIds: [],
    };

    expect(sameHomeSnapshot(snapshot, normalizeHomeSnapshot(reordered))).toBe(
      true,
    );
  });

  it('notices a banner image that changed after publishing', () => {
    const published = buildHomeSnapshot(DEFAULT_HOME_LAYOUT, [makeBanner()]);
    const draft = buildHomeSnapshot(DEFAULT_HOME_LAYOUT, [
      makeBanner({ desktop: { src: '/new.webp', width: 1600, height: 500 } }),
    ]);

    expect(sameHomeSnapshot(draft, published)).toBe(false);
  });

  it('treats a home that was never published as different from any draft', () => {
    const draft = buildHomeSnapshot(DEFAULT_HOME_LAYOUT, []);

    expect(normalizeHomeSnapshot(null)).toBeNull();
    expect(sameHomeSnapshot(draft, null)).toBe(false);
  });
});
