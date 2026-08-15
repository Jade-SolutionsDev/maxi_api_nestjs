import { DataSource } from 'typeorm';
import { DEFAULT_SITE_SETTINGS } from '../src/cms/cms.service';
import { CmsBanner } from '../src/cms/entities/cms-banner.entity';
import { CmsPage } from '../src/cms/entities/cms-page.entity';
import { CmsService } from '../src/cms/entities/cms-service.entity';
import { CmsSiteSettings } from '../src/cms/entities/cms-site-settings.entity';
import { CmsStaffMember } from '../src/cms/entities/cms-staff-member.entity';

/**
 * Seeds the CMS with the content the storefront used to hardcode, so the
 * first CMS-driven deploy renders pixel-identical to the static version.
 * Idempotent — matched by natural key (slug/alt/title), never destructive.
 *
 * Run: pnpm run seed:cms
 */
const DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgres://maxihabana:maxihabana@localhost:5432/maxihabana';

const dataSource = new DataSource({
  type: 'postgres',
  url: DATABASE_URL,
  entities: [CmsPage, CmsBanner, CmsService, CmsSiteSettings, CmsStaffMember],
  synchronize: false, // tables already exist (managed by the app); only insert.
});

const BANNER_BASE = 'https://maxi-media-prod.s3.us-east-1.amazonaws.com/BANNER/';

// Copied verbatim from the storefront's src/feature/home/mock/banners.ts.
const BANNERS = [
  {
    alt: 'Promociones Maxi',
    sortOrder: 0,
    desktop: {
      src: `${BANNER_BASE}ae14364c-4796-4f03-89fd-4edfe4dcf9c2.webp`,
      width: 1921,
      height: 393,
    },
    tablet: {
      src: `${BANNER_BASE}82992c54-398d-4ca6-a2ba-e56d0073c8a8.webp`,
      width: 745,
      height: 1048,
    },
    mobile: {
      src: `${BANNER_BASE}bc87ffbc-4ba6-4167-98ac-dd506d69a569.webp`,
      width: 361,
      height: 537,
    },
  },
  {
    alt: 'Ofertas Maxi',
    sortOrder: 1,
    desktop: {
      src: `${BANNER_BASE}d53bf5db-cbfd-4245-8ca9-2f7a6e6c9ac3.webp`,
      width: 5761,
      height: 1177,
    },
    tablet: {
      src: `${BANNER_BASE}2d65782a-c84f-4b05-a5a8-4b30b068aa34.webp`,
      width: 4099,
      height: 1177,
    },
    mobile: {
      src: `${BANNER_BASE}27302fce-9122-40b2-b5dc-c7c46c071b22.webp`,
      width: 1081,
      height: 1609,
    },
  },
  {
    alt: 'Descuentos Maxi',
    sortOrder: 2,
    desktop: {
      src: `${BANNER_BASE}b5822991-9348-4c35-94c2-b8e81f869939.webp`,
      width: 5761,
      height: 1177,
    },
    tablet: {
      src: `${BANNER_BASE}002cb15c-86d3-410a-a6c8-e299c7e10c83.webp`,
      width: 2233,
      height: 3142,
    },
    mobile: {
      src: `${BANNER_BASE}61e973dd-8347-4252-9df1-658e789fe724.webp`,
      width: 1081,
      height: 1609,
    },
  },
];

// Copied verbatim from the storefront's src/feature/home/constants/services.ts.
const SERVICES = [
  {
    icon: 'ShieldCheck',
    title: 'Tranquilidad de espíritu',
    description: 'Garantía de devolución de 30 días',
    isFeatured: true,
    sortOrder: 0,
  },
  {
    icon: 'Lock',
    title: 'Pago 100% seguro',
    description: 'Tu pago está seguro con nosotros',
    isFeatured: false,
    sortOrder: 1,
  },
  {
    icon: 'MessageSquareText',
    title: 'Soporte 24/7',
    description: 'Soporte en línea 24/7',
    isFeatured: false,
    sortOrder: 2,
  },
];

const PAGES = [
  {
    slug: 'sobre-nosotros',
    title: 'Sobre nosotros',
    content:
      'Del mercado a tu mesa, sin complicaciones.\n\n' +
      'En Maxi conectamos a tu familia en La Habana con productos frescos y de ' +
      'confianza, con entrega rápida y atención cercana. Estamos trabajando en ' +
      'esta sección. Próximamente más información.',
    sortOrder: 0,
  },
  {
    slug: 'politica-de-privacidad',
    title: 'Política de privacidad',
    content:
      '## Política de privacidad\n\n' +
      'Contenido pendiente de redacción. Edita esta página desde el panel de ' +
      'administración (Contenido → Páginas).',
    sortOrder: 1,
  },
  {
    slug: 'terminos-y-condiciones',
    title: 'Términos y condiciones',
    content:
      '## Términos y condiciones\n\n' +
      'Contenido pendiente de redacción. Edita esta página desde el panel de ' +
      'administración (Contenido → Páginas).',
    sortOrder: 2,
  },
  {
    slug: 'politica-de-reembolso',
    title: 'Política de reembolso',
    content:
      '## Política de reembolso\n\n' +
      'Contenido pendiente de redacción. Edita esta página desde el panel de ' +
      'administración (Contenido → Páginas).',
    sortOrder: 3,
  },
];

async function main(): Promise<void> {
  await dataSource.initialize();

  const pageRepo = dataSource.getRepository(CmsPage);
  for (const page of PAGES) {
    const existing = await pageRepo.findOne({
      where: { slug: page.slug },
      withDeleted: true,
    });
    if (existing) {
      console.log(`page "${page.slug}" already exists — skipped`);
      continue;
    }
    await pageRepo.save(pageRepo.create(page));
    console.log(`page "${page.slug}" created`);
  }

  const bannerRepo = dataSource.getRepository(CmsBanner);
  for (const banner of BANNERS) {
    const existing = await bannerRepo.findOne({
      where: { alt: banner.alt },
      withDeleted: true,
    });
    if (existing) {
      console.log(`banner "${banner.alt}" already exists — skipped`);
      continue;
    }
    await bannerRepo.save(bannerRepo.create(banner));
    console.log(`banner "${banner.alt}" created`);
  }

  const serviceRepo = dataSource.getRepository(CmsService);
  for (const service of SERVICES) {
    const existing = await serviceRepo.findOne({
      where: { title: service.title },
      withDeleted: true,
    });
    if (existing) {
      console.log(`service "${service.title}" already exists — skipped`);
      continue;
    }
    await serviceRepo.save(serviceRepo.create(service));
    console.log(`service "${service.title}" created`);
  }

  const settingsRepo = dataSource.getRepository(CmsSiteSettings);
  const settingsCount = await settingsRepo.count();
  if (settingsCount === 0) {
    await settingsRepo.save(
      settingsRepo.create({ data: DEFAULT_SITE_SETTINGS }),
    );
    console.log('site settings created with defaults');
  } else {
    console.log('site settings already exist — skipped');
  }

  await dataSource.destroy();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
