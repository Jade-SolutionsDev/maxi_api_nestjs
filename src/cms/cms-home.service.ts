import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { timingSafeEqual } from 'node:crypto';
import { In, Repository } from 'typeorm';
import { Category } from '../categories/entities/category.entity';
import type { StorefrontConfig } from '../config/configuration';
import { Product } from '../products/entities/product.entity';
import {
  CMS_REVALIDATE_TAGS,
  RevalidationService,
} from '../revalidation/revalidation.service';
import type { User } from '../users/entities/user.entity';
import { BannerView } from './cms-banner.types';
import { CmsService } from './cms.service';
import {
  CmsHomeChangesService,
  describeActor,
} from './cms-home-changes.service';
import {
  buildHomeSnapshot,
  DEFAULT_HOME_LAYOUT,
  layoutOf,
  normalizeHomeLayout,
  normalizeHomeSnapshot,
  sameHomeSnapshot,
} from './cms-home.layout';
import { signHomePreviewToken } from './cms-home-preview-token';
import {
  CmsHomeChangeAction,
  HomeBannerSnapshot,
  HomeLayout,
  HomeSnapshot,
} from './cms-home.types';
import { CmsBanner } from './entities/cms-banner.entity';
import { CmsHome } from './entities/cms-home.entity';

/** Long enough to open the tab and look around; short enough to not leak. */
const PREVIEW_TTL_MS = 30 * 60 * 1000;

export interface CmsHomeEditorState {
  layout: HomeLayout;
  updatedAt: Date | null;
  updatedBy: string | null;
  publishedAt: Date | null;
  publishedBy: string | null;
  hasUnpublishedChanges: boolean;
}

export interface PublicHomeView {
  layout: HomeLayout;
  banners: BannerView<HomeBannerSnapshot>[];
}

/**
 * Draft → preview → publish for the storefront home. Only `publish` pings the
 * storefront: every other write stays in the draft, which the store renders
 * solely in draft mode (see createPreviewLink / getDraftHome).
 */
@Injectable()
export class CmsHomeService {
  constructor(
    @InjectRepository(CmsHome)
    private readonly homeRepository: Repository<CmsHome>,
    @InjectRepository(CmsBanner)
    private readonly bannerRepository: Repository<CmsBanner>,
    @InjectRepository(Product)
    private readonly productRepository: Repository<Product>,
    @InjectRepository(Category)
    private readonly categoryRepository: Repository<Category>,
    private readonly cmsService: CmsService,
    private readonly changes: CmsHomeChangesService,
    private readonly revalidationService: RevalidationService,
    private readonly configService: ConfigService,
  ) {}

  async getEditorState(): Promise<CmsHomeEditorState> {
    const row = await this.getRow();
    const draft = await this.buildDraftSnapshot(row);
    return this.toEditorState(row, draft);
  }

  async updateLayout(
    layout: HomeLayout,
    actor: User,
  ): Promise<CmsHomeEditorState> {
    const normalized = normalizeHomeLayout(layout);
    await this.assertProductsExist(normalized.featuredProductIds);
    await this.assertDepartmentsExist(normalized.featuredDepartmentIds);

    const row = (await this.getRow()) ?? this.createRow();
    row.draft = normalized;
    row.draftUpdatedAt = new Date();
    row.draftUpdatedBy = describeActor(actor);
    const saved = await this.homeRepository.save(row);
    await this.changes.record(CmsHomeChangeAction.LAYOUT_UPDATED, null, actor);

    return this.toEditorState(saved, await this.buildDraftSnapshot(saved));
  }

  async publish(actor: User): Promise<CmsHomeEditorState> {
    const row = (await this.getRow()) ?? this.createRow();
    const snapshot = await this.buildDraftSnapshot(row);
    row.published = snapshot;
    row.publishedAt = new Date();
    row.publishedBy = describeActor(actor);
    const saved = await this.homeRepository.save(row);
    await this.changes.record(CmsHomeChangeAction.PUBLISHED, null, actor);
    this.revalidationService.notify(CMS_REVALIDATE_TAGS);

    return this.toEditorState(saved, snapshot);
  }

  /** What the live store shows. Never published → the default home. */
  async getPublishedHome(): Promise<PublicHomeView> {
    const row = await this.getRow();
    const published =
      normalizeHomeSnapshot(row?.published) ??
      buildHomeSnapshot(DEFAULT_HOME_LAYOUT, []);
    return this.toPublicView(published);
  }

  /** What the store would show if the editor published right now. */
  async getDraftHome(): Promise<PublicHomeView> {
    const row = await this.getRow();
    return this.toPublicView(await this.buildDraftSnapshot(row));
  }

  /** Storefront URL that switches the editor's browser into draft mode. */
  createPreviewLink(now: Date = new Date()): { url: string; expiresAt: Date } {
    const { url, revalidateSecret } = this.storefront();
    if (!url || !revalidateSecret) {
      throw new ServiceUnavailableException(
        'La vista previa no está disponible: falta configurar STOREFRONT_URL y STOREFRONT_REVALIDATE_SECRET.',
      );
    }
    const expiresAt = new Date(now.getTime() + PREVIEW_TTL_MS);
    const link = new URL(`${url}/api/vista-previa`);
    link.searchParams.set(
      'token',
      signHomePreviewToken(revalidateSecret, expiresAt),
    );
    return { url: link.toString(), expiresAt };
  }

  /** The draft is only for the storefront server, which holds the shared secret. */
  assertStorefrontSecret(received: string | undefined): void {
    const { revalidateSecret } = this.storefront();
    const expected = Buffer.from(revalidateSecret ?? '');
    const given = Buffer.from(received ?? '');
    if (
      !expected.length ||
      expected.length !== given.length ||
      !timingSafeEqual(expected, given)
    ) {
      throw new UnauthorizedException('Borrador no disponible');
    }
  }

  private storefront(): StorefrontConfig {
    return (
      this.configService.get<StorefrontConfig>('storefront') ?? {
        url: undefined,
        revalidateSecret: undefined,
      }
    );
  }

  private async getRow(): Promise<CmsHome | null> {
    const rows = await this.homeRepository.find({ take: 1 });
    return rows[0] ?? null;
  }

  private createRow(): CmsHome {
    return this.homeRepository.create({
      draft: normalizeHomeLayout(null),
      published: null,
      draftUpdatedAt: null,
      draftUpdatedBy: null,
      publishedAt: null,
      publishedBy: null,
    });
  }

  private async buildDraftSnapshot(row: CmsHome | null): Promise<HomeSnapshot> {
    const banners = await this.bannerRepository.find({
      where: { isActive: true },
      order: { sortOrder: 'ASC', createdAt: 'ASC' },
    });
    return buildHomeSnapshot(normalizeHomeLayout(row?.draft), banners);
  }

  private toEditorState(
    row: CmsHome | null,
    draft: HomeSnapshot,
  ): CmsHomeEditorState {
    return {
      layout: layoutOf(draft),
      updatedAt: row?.draftUpdatedAt ?? null,
      updatedBy: row?.draftUpdatedBy ?? null,
      publishedAt: row?.publishedAt ?? null,
      publishedBy: row?.publishedBy ?? null,
      hasUnpublishedChanges: !sameHomeSnapshot(
        draft,
        normalizeHomeSnapshot(row?.published),
      ),
    };
  }

  private async toPublicView(snapshot: HomeSnapshot): Promise<PublicHomeView> {
    return {
      layout: layoutOf(snapshot),
      banners: await this.cmsService.resolveVisibleBanners(snapshot.banners),
    };
  }

  private async assertProductsExist(ids: string[]): Promise<void> {
    if (!ids.length) return;
    const found = await this.productRepository.find({
      where: { id: In(ids) },
      select: { id: true },
    });
    const missing = ids.filter((id) => !found.some((row) => row.id === id));
    if (missing.length) {
      throw new BadRequestException(
        `Estos productos destacados no existen: ${missing.join(', ')}`,
      );
    }
  }

  private async assertDepartmentsExist(ids: string[]): Promise<void> {
    if (!ids.length) return;
    const found = await this.categoryRepository.find({
      where: { id: In(ids) },
      select: { id: true, parentId: true },
    });
    const missing = ids.filter(
      (id) => !found.some((row) => row.id === id && row.parentId === null),
    );
    if (missing.length) {
      throw new BadRequestException(
        `Estos departamentos destacados no existen: ${missing.join(', ')}`,
      );
    }
  }
}
