import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  IsNull,
  LessThanOrEqual,
  MoreThan,
  Not,
  Or,
  Repository,
} from 'typeorm';
import { slugify } from '../common/utils/catalog-ownership.utils';
import {
  CMS_REVALIDATE_TAGS,
  RevalidationService,
} from '../revalidation/revalidation.service';
import type { User } from '../users/entities/user.entity';
import { isBlankText, publicationStatusOf } from './cms-page.publication';
import { describeActor } from './cms-home-changes.service';
import { CreateCmsPageDto, UpdateCmsPageDto } from './dto/cms-page.dto';
import { CmsPage, CmsPageKind } from './entities/cms-page.entity';
import { CmsPageVersion } from './entities/cms-page-version.entity';

const WITH_PUBLISHED = { publishedVersion: true } as const;

/** What the store shows of a page besides its text, as a comparable key. */
const liveSettingsOf = (page: CmsPage): string =>
  JSON.stringify([
    page.slug,
    page.sortOrder,
    page.isActive,
    page.startsAt?.getTime() ?? null,
    page.endsAt?.getTime() ?? null,
  ]);

/**
 * Info pages and home notices: a draft edited in place and a published copy
 * frozen into cms_page_versions. Editing the text never reaches the store;
 * only `publish` does, and every publication is kept with author and date.
 * Every method takes the kind so a notice can never be read or edited
 * through the pages routes, nor the other way round.
 */
@Injectable()
export class CmsPagesService {
  constructor(
    @InjectRepository(CmsPage)
    private readonly pageRepository: Repository<CmsPage>,
    @InjectRepository(CmsPageVersion)
    private readonly versionRepository: Repository<CmsPageVersion>,
    private readonly revalidationService: RevalidationService,
  ) {}

  // ---------------- Backoffice ----------------

  async create(
    kind: CmsPageKind,
    dto: CreateCmsPageDto,
    actor: User,
  ): Promise<CmsPage> {
    const schedule = this.resolveSchedule(kind, dto, {
      startsAt: null,
      endsAt: null,
    });
    const slug = await this.ensureUniqueSlug(dto.slug ?? dto.title);
    const page = this.pageRepository.create({
      kind,
      slug,
      title: dto.title,
      content: dto.content,
      sortOrder: dto.sortOrder ?? 0,
      isActive: dto.isActive ?? true,
      ...schedule,
      draftUpdatedAt: new Date(),
      draftUpdatedBy: describeActor(actor),
      publishedVersionId: null,
    });
    return this.pageRepository.save(page);
  }

  listAdmin(kind: CmsPageKind): Promise<CmsPage[]> {
    return this.pageRepository.find({
      where: { kind },
      relations: WITH_PUBLISHED,
      order: { sortOrder: 'ASC', title: 'ASC' },
    });
  }

  async get(kind: CmsPageKind, id: string): Promise<CmsPage> {
    const page = await this.pageRepository.findOne({
      where: { id, kind },
      relations: WITH_PUBLISHED,
    });
    if (!page) {
      throw new NotFoundException(`Page with id "${id}" not found`);
    }
    return page;
  }

  /**
   * Title and content go to the draft. Slug, order, visibility and schedule
   * are live settings: when one of them really changes on a page the store
   * shows, the store is pinged. The backoffice form sends every field on each
   * save, so presence alone is not a change.
   */
  async update(
    kind: CmsPageKind,
    id: string,
    dto: UpdateCmsPageDto,
    actor: User,
  ): Promise<CmsPage> {
    const page = await this.get(kind, id);
    const liveBefore = liveSettingsOf(page);
    Object.assign(page, this.resolveSchedule(kind, dto, page));

    const textChanged =
      (dto.title !== undefined && dto.title !== page.title) ||
      (dto.content !== undefined && dto.content !== page.content);
    if (dto.title !== undefined) page.title = dto.title;
    if (dto.content !== undefined) page.content = dto.content;
    if (textChanged) {
      page.draftUpdatedAt = new Date();
      page.draftUpdatedBy = describeActor(actor);
    }

    if (dto.slug !== undefined && slugify(dto.slug) !== page.slug) {
      page.slug = await this.ensureUniqueSlug(dto.slug, id);
    }
    if (dto.sortOrder !== undefined) page.sortOrder = dto.sortOrder;
    if (dto.isActive !== undefined) page.isActive = dto.isActive;

    const saved = await this.pageRepository.save(page);
    if (page.publishedVersionId && liveSettingsOf(page) !== liveBefore) {
      this.revalidationService.notify(CMS_REVALIDATE_TAGS);
    }
    return saved;
  }

  /**
   * Freezes the draft as the next version and points the store at it.
   * `publishedVersion` is always the latest version — publishing is the only
   * writer — so the next number derives from it; the unique (page, version)
   * index rejects the rare double click that would duplicate one.
   */
  async publish(kind: CmsPageKind, id: string, actor: User): Promise<CmsPage> {
    const page = await this.get(kind, id);
    if (isBlankText(page.content)) {
      throw new BadRequestException(
        'No puedes publicar un texto vacío: escribe el contenido antes de publicarlo.',
      );
    }
    if (publicationStatusOf(page) === 'published') {
      throw new BadRequestException(
        'No hay cambios que publicar: la tienda ya muestra este texto.',
      );
    }

    const version = await this.versionRepository.save(
      this.versionRepository.create({
        pageId: page.id,
        version: (page.publishedVersion?.version ?? 0) + 1,
        title: page.title,
        content: page.content,
        publishedById: actor.id,
        publishedByName: describeActor(actor),
      }),
    );
    page.publishedVersionId = version.id;
    page.publishedVersion = version;
    const saved = await this.pageRepository.save(page);
    this.revalidationService.notify(CMS_REVALIDATE_TAGS);
    return saved;
  }

  async listVersions(kind: CmsPageKind, id: string): Promise<CmsPageVersion[]> {
    await this.get(kind, id);
    return this.versionRepository.find({
      where: { pageId: id },
      order: { version: 'DESC' },
    });
  }

  /**
   * Frees the slug before soft-deleting: slug uniqueness counts soft-deleted
   * rows, and footer legal links reference pages BY SLUG — without this,
   * recreating a deleted page ("terminos-y-condiciones") would land on a
   * suffixed slug ("-2") and silently break every stored reference. The
   * version history stays: it is the record of what the store showed.
   */
  async remove(kind: CmsPageKind, id: string): Promise<void> {
    const page = await this.get(kind, id);
    page.slug = `${page.slug}-eliminada-${Date.now()}`;
    await this.pageRepository.save(page);
    await this.pageRepository.softDelete(id);
    if (page.publishedVersionId) {
      this.revalidationService.notify(CMS_REVALIDATE_TAGS);
    }
  }

  // ---------------- Storefront ----------------

  listPublishedPages(): Promise<CmsPage[]> {
    return this.pageRepository.find({
      where: {
        kind: CmsPageKind.PAGE,
        isActive: true,
        publishedVersionId: Not(IsNull()),
      },
      relations: WITH_PUBLISHED,
      order: { sortOrder: 'ASC', slug: 'ASC' },
    });
  }

  async getPublishedPage(slug: string): Promise<CmsPage> {
    const page = await this.pageRepository.findOne({
      where: {
        slug,
        kind: CmsPageKind.PAGE,
        isActive: true,
        publishedVersionId: Not(IsNull()),
      },
      relations: WITH_PUBLISHED,
    });
    if (!page) {
      throw new NotFoundException(`Page with slug "${slug}" not found`);
    }
    return page;
  }

  listVisibleHomeNotices(now: Date = new Date()): Promise<CmsPage[]> {
    return this.pageRepository.find({
      where: {
        kind: CmsPageKind.HOME_NOTICE,
        isActive: true,
        publishedVersionId: Not(IsNull()),
        startsAt: Or(IsNull(), LessThanOrEqual(now)),
        endsAt: Or(IsNull(), MoreThan(now)),
      },
      relations: WITH_PUBLISHED,
      order: { sortOrder: 'ASC', createdAt: 'ASC' },
    });
  }

  // ---------------- Internal helpers ----------------

  /**
   * Only home notices carry dates; an info page is always off schedule.
   * Undefined keeps the current value, null clears it.
   */
  private resolveSchedule(
    kind: CmsPageKind,
    dto: Pick<CreateCmsPageDto, 'startsAt' | 'endsAt'>,
    current: Pick<CmsPage, 'startsAt' | 'endsAt'>,
  ): Pick<CmsPage, 'startsAt' | 'endsAt'> {
    if (kind !== CmsPageKind.HOME_NOTICE) {
      return { startsAt: null, endsAt: null };
    }
    const pick = (value: string | null | undefined, fallback: Date | null) =>
      value === undefined ? fallback : value === null ? null : new Date(value);
    const startsAt = pick(dto.startsAt, current.startsAt);
    const endsAt = pick(dto.endsAt, current.endsAt);
    if (startsAt && endsAt && endsAt <= startsAt) {
      throw new BadRequestException(
        'El aviso debe terminar después de empezar: revisa las fechas.',
      );
    }
    return { startsAt, endsAt };
  }

  // Same contract as the taxonomy slug helper: derive from the source text,
  // then suffix -2, -3… until unique (soft-deleted rows included so a slug is
  // never resurrected under different content).
  private async ensureUniqueSlug(
    source: string,
    excludeId?: string,
  ): Promise<string> {
    const base = slugify(source);
    let candidate = base;
    let suffix = 2;
    for (;;) {
      const clash = await this.pageRepository.findOne({
        where: excludeId
          ? { slug: candidate, id: Not(excludeId) }
          : { slug: candidate },
        withDeleted: true,
      });
      if (!clash) {
        return candidate;
      }
      // A soft-deleted row is a leftover, not an owner: reclaim its slug (the
      // same rename remove applies) so recreating a page always lands on the
      // canonical slug the storefront references.
      if (clash.deletedAt) {
        await this.pageRepository.update(clash.id, {
          slug: `${clash.slug}-eliminada-${Date.now()}`,
        });
        return candidate;
      }
      candidate = `${base}-${suffix}`;
      suffix += 1;
    }
  }
}
