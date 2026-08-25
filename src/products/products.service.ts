import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { slugify } from '../common/utils/catalog-ownership.utils';
import { CategoriesService } from '../categories/categories.service';
import {
  PRODUCT_REVALIDATE_TAGS,
  RevalidationService,
} from '../revalidation/revalidation.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { Product } from './entities/product.entity';

export interface ProductFilters {
  q?: string;
  departmentId?: string;
  categoryId?: string;
  /** Slug alternatives, used by the storefront's readable filter urls. */
  categorySlug?: string;
  departmentSlug?: string;
  minPrice?: number;
  maxPrice?: number;
  /**
   * Column the price range filters on. Defaults to the list price; the
   * storefront passes `finalPrice` so the range matches the discounted price
   * it displays (same expression the `finalPrice` sort uses).
   */
  priceField?: 'basePrice' | 'finalPrice';
  featured?: boolean;
  /**
   * `true` → only discounted products, `false` → only products at list price.
   * Omitted → no discount filter.
   */
  onSale?: boolean;
  isActive?: boolean;
  sortBy?: 'name' | 'price' | 'finalPrice' | 'createdAt' | 'updatedAt';
  sortOrder?: 'asc' | 'desc';
}

/**
 * Delivery area a storefront stock lookup is scoped to. Precedence:
 * `locationId` (one storage) > `municipalityId`/`provinceId` (storages
 * covering the area) > none (all active storages).
 */
export interface StorefrontArea {
  locationId?: string;
  provinceId?: string;
  municipalityId?: string;
}

// Global catalog: no provider scoping. Every authenticated backoffice user can
// read; writes are gated to SUPER_ADMIN/ADMIN/KARDIST at the controller.
@Injectable()
export class ProductsService {
  constructor(
    @InjectRepository(Product)
    private readonly productRepository: Repository<Product>,
    private readonly categoriesService: CategoriesService,
    private readonly revalidationService: RevalidationService,
  ) {}

  // ponytail: returns all matching rows (no server pagination) — matches
  // categories/clients; the catalog is small. Add paging if it grows.
  async findAll(filters: ProductFilters = {}): Promise<Product[]> {
    const qb = this.productRepository.createQueryBuilder('product');

    if (filters.categoryId) {
      qb.andWhere('product.categoryId = :categoryId', {
        categoryId: filters.categoryId,
      });
    }
    if (filters.departmentId) {
      // A product's department is the parent of its category. Raw subquery →
      // use the real column name (product.category_id), not the entity property.
      qb.andWhere(
        `EXISTS (SELECT 1 FROM categories c
           WHERE c.id = product.category_id
             AND c.parent_id = :departmentId
             AND c.deleted_at IS NULL)`,
        { departmentId: filters.departmentId },
      );
    }
    // Slug variants of the taxonomy filters: what the storefront sends, so its
    // urls read /catalog?category=bebidas instead of exposing uuids. Slugs are
    // unique across the categories table (departments included).
    if (filters.categorySlug) {
      qb.andWhere(
        `EXISTS (SELECT 1 FROM categories c
           WHERE c.id = product.category_id
             AND c.slug = :categorySlug
             AND c.deleted_at IS NULL)`,
        { categorySlug: filters.categorySlug },
      );
    }
    if (filters.departmentSlug) {
      qb.andWhere(
        `EXISTS (SELECT 1 FROM categories c
           JOIN categories d ON d.id = c.parent_id AND d.deleted_at IS NULL
           WHERE c.id = product.category_id
             AND d.slug = :departmentSlug
             AND c.deleted_at IS NULL)`,
        { departmentSlug: filters.departmentSlug },
      );
    }
    if (filters.q) {
      qb.andWhere('product.name ILIKE :q', { q: `%${filters.q}%` });
    }
    const priceExpr =
      filters.priceField === 'finalPrice'
        ? 'product.basePrice * (1 - product.discount / 100)'
        : 'product.basePrice';
    if (filters.minPrice != null) {
      qb.andWhere(`${priceExpr} >= :minPrice`, {
        minPrice: filters.minPrice,
      });
    }
    if (filters.maxPrice != null) {
      qb.andWhere(`${priceExpr} <= :maxPrice`, {
        maxPrice: filters.maxPrice,
      });
    }
    if (filters.featured != null) {
      qb.andWhere('product.isFeatured = :featured', {
        featured: filters.featured,
      });
    }
    if (filters.onSale != null) {
      // A product is "on sale" when it carries a discount percentage.
      qb.andWhere(
        filters.onSale ? 'product.discount > 0' : 'product.discount = 0',
      );
    }
    if (filters.isActive != null) {
      qb.andWhere('product.isActive = :isActive', {
        isActive: filters.isActive,
      });
    }

    const dir = (filters.sortOrder ?? 'asc').toUpperCase() as 'ASC' | 'DESC';
    switch (filters.sortBy) {
      case 'name':
        qb.orderBy('product.name', dir);
        break;
      case 'price':
        qb.orderBy('product.basePrice', dir);
        break;
      case 'finalPrice':
        // Discounted price: basePrice * (1 - discount/100). Mirrors
        // ProductResponseDto.fromEntity's finalPrice. TypeORM maps the
        // `product.<prop>` tokens to their columns.
        qb.orderBy('product.basePrice * (1 - product.discount / 100)', dir);
        break;
      case 'createdAt':
        qb.orderBy('product.createdAt', dir);
        break;
      case 'updatedAt':
        qb.orderBy('product.updatedAt', dir);
        break;
      default:
        // Catalog order: curated first, then newest.
        qb.orderBy('product.sortOrder', 'ASC').addOrderBy(
          'product.createdAt',
          'DESC',
        );
    }
    return qb.getMany();
  }

  // Total physical stock per product, summed across all storages. Queries the
  // inventory table directly (raw) to avoid coupling ProductsModule to the
  // inventory entity. Products with no inventory rows are simply absent (→ 0).
  async amountsFor(productIds: string[]): Promise<Map<string, number>> {
    return this.sumInventory(productIds, 'i.quantity', false);
  }

  // Sellable stock per product: physical minus what pending orders hold
  // (inventory.reserved_quantity), counting only ENABLED storages — stock in a
  // disabled/soft-deleted location is not available. This is what the storefront
  // and cart see.
  async availableFor(productIds: string[]): Promise<Map<string, number>> {
    return this.sumInventory(
      productIds,
      'i.quantity - i.reserved_quantity',
      true,
    );
  }

  private async sumInventory(
    productIds: string[],
    expr: 'i.quantity' | 'i.quantity - i.reserved_quantity',
    activeLocationsOnly: boolean,
  ): Promise<Map<string, number>> {
    if (productIds.length === 0) return new Map();
    const activeJoin = activeLocationsOnly
      ? `JOIN stock_locations sl
             ON sl.id = i.location_id
            AND sl.is_active = true
            AND sl.deleted_at IS NULL`
      : '';
    const rows: { product_id: string; total: number }[] =
      await this.productRepository.manager.query(
        `SELECT i.product_id, COALESCE(SUM(${expr}), 0)::int AS total
           FROM inventory i
           ${activeJoin}
          WHERE i.product_id = ANY($1)
          GROUP BY i.product_id`,
        [productIds],
      );
    return new Map(rows.map((r) => [r.product_id, Number(r.total)]));
  }

  // Storefront listing: active products with sellable stock (physical minus
  // order reservations). Reuses findAll for the catalog filters, then attaches
  // stock scoped to a set of storages and drops out-of-stock rows unless
  // includeOutOfStock is set. Scope precedence: explicit `locationId` (a single
  // warehouse) > `municipalityId`/`provinceId` (the storages covering that
  // delivery area) > all active storages.
  // ponytail: stock filter + limit applied in JS over the (small) catalog;
  // push into SQL with a LIMIT if it ever grows.
  async findStorefront(
    filters: ProductFilters,
    opts: StorefrontArea & { includeOutOfStock?: boolean } = {},
  ): Promise<{ product: Product; stock: number }[]> {
    const products = await this.findAll({ ...filters, isActive: true });

    const stock = await this.availableForArea(
      products.map((p) => p.id),
      opts,
    );

    const rows = products.map((p) => ({
      product: p,
      stock: stock.get(p.id) ?? 0,
    }));
    // Full stock-filtered, sorted list; the controller paginates it.
    return opts.includeOutOfStock ? rows : rows.filter((r) => r.stock > 0);
  }

  // Sellable stock per product scoped to a delivery area (see StorefrontArea
  // for the scope precedence). No area → global, same as availableFor.
  async availableForArea(
    productIds: string[],
    area: StorefrontArea = {},
  ): Promise<Map<string, number>> {
    // null scope → sum across all active storages (no geo filter).
    let scope: string[] | null = null;
    if (area.locationId) {
      scope = [area.locationId];
    } else if (area.municipalityId || area.provinceId) {
      scope = await this.coveringLocationIds({
        provinceId: area.provinceId,
        municipalityId: area.municipalityId,
      });
    }

    return this.stockMap(scope, productIds);
  }

  // Active storages that deliver to a place. By municipality: those covering the
  // municipality directly, OR the whole province it belongs to (derived from the
  // municipality). By province alone: those with province-wide coverage. Disabled
  // /soft-deleted storages are excluded. Empty result → nothing is deliverable.
  private async coveringLocationIds(area: {
    provinceId?: string;
    municipalityId?: string;
  }): Promise<string[]> {
    const activeJoin = `JOIN stock_locations sl
             ON sl.id = c.location_id
            AND sl.is_active = true
            AND sl.deleted_at IS NULL`;
    let rows: { location_id: string }[];
    if (area.municipalityId) {
      rows = await this.productRepository.manager.query(
        `SELECT DISTINCT c.location_id
           FROM stock_location_coverage c
           ${activeJoin}
          WHERE c.municipality_id = $1
             OR (c.coverage_type = 'province'
                 AND c.province_id = (SELECT province_id FROM municipalities WHERE id = $1))`,
        [area.municipalityId],
      );
    } else {
      rows = await this.productRepository.manager.query(
        `SELECT DISTINCT c.location_id
           FROM stock_location_coverage c
           ${activeJoin}
          WHERE c.coverage_type = 'province' AND c.province_id = $1`,
        [area.provinceId],
      );
    }
    return rows.map((r) => r.location_id);
  }

  // Sellable stock per product, summed over a set of storages. `null` scope sums
  // across every active storage; an empty array means no storage qualifies (→ no
  // stock). Always net of reservations and only from enabled storages (a disabled
  // location yields 0) — feeds the storefront.
  private async stockMap(
    locationIds: string[] | null,
    productIds: string[],
  ): Promise<Map<string, number>> {
    if (productIds.length === 0) return new Map();
    if (locationIds === null) return this.availableFor(productIds);
    if (locationIds.length === 0) return new Map();
    const rows: { product_id: string; total: number }[] =
      await this.productRepository.manager.query(
        `SELECT i.product_id, COALESCE(SUM(i.quantity - i.reserved_quantity), 0)::int AS total
           FROM inventory i
           JOIN stock_locations sl
             ON sl.id = i.location_id
            AND sl.is_active = true
            AND sl.deleted_at IS NULL
          WHERE i.location_id = ANY($1) AND i.product_id = ANY($2)
          GROUP BY i.product_id`,
        [locationIds, productIds],
      );
    return new Map(rows.map((r) => [r.product_id, Number(r.total)]));
  }

  async findOne(id: string): Promise<Product> {
    const product = await this.productRepository.findOne({
      where: { id },
      relations: { category: true },
    });
    if (!product) {
      throw new NotFoundException(`Product with id "${id}" not found`);
    }
    return product;
  }

  async create(dto: CreateProductDto): Promise<Product> {
    const category = await this.categoriesService.getChildCategoryOrThrow(
      dto.categoryId,
    );

    // Explicit SKU is the user's chosen identifier → conflict is an error.
    // Omitted SKU is auto-derived from the name and deduplicated.
    let sku: string;
    if (dto.sku) {
      sku = dto.sku.trim();
      await this.guardDuplicateSku(sku);
    } else {
      sku = await this.generateUniqueSku(dto.name);
    }

    const slug = await this.ensureUniqueSlug(dto.slug ?? dto.name);

    const product = this.productRepository.create({
      categoryId: category.id,
      sku,
      name: dto.name,
      slug,
      description: dto.description ?? null,
      imageUrl: dto.imageUrl ?? null,
      format: dto.format ?? null,
      expiryDate: dto.expiryDate ?? null,
      measureUnit: dto.measureUnit ?? 'unidad',
      basePrice: dto.basePrice.toFixed(2),
      discount: (dto.discount ?? 0).toFixed(2),
      isFeatured: dto.featured ?? false,
      sortOrder: dto.sortOrder ?? 0,
      isActive: dto.isActive ?? true,
    });

    const saved = await this.productRepository.save(product);
    this.revalidationService.notify(PRODUCT_REVALIDATE_TAGS);
    return saved;
  }

  async update(id: string, dto: UpdateProductDto): Promise<Product> {
    const product = await this.findOne(id);

    if (dto.categoryId !== undefined) {
      const category = await this.categoriesService.getChildCategoryOrThrow(
        dto.categoryId,
      );
      product.categoryId = category.id;
    }

    if (dto.sku !== undefined) {
      const sku = dto.sku.trim();
      await this.guardDuplicateSku(sku, id);
      product.sku = sku;
    }

    if (dto.name !== undefined) {
      product.name = dto.name;
    }

    if (dto.slug !== undefined) {
      product.slug = await this.ensureUniqueSlug(dto.slug, id);
    } else if (dto.name !== undefined) {
      product.slug = await this.ensureUniqueSlug(dto.name, id);
    }

    if (dto.description !== undefined) {
      product.description = dto.description;
    }
    if (dto.imageUrl !== undefined) {
      product.imageUrl = dto.imageUrl;
    }
    if (dto.format !== undefined) {
      product.format = dto.format;
    }
    if (dto.expiryDate !== undefined) {
      product.expiryDate = dto.expiryDate;
    }
    if (dto.measureUnit !== undefined) {
      product.measureUnit = dto.measureUnit;
    }
    if (dto.basePrice !== undefined) {
      product.basePrice = dto.basePrice.toFixed(2);
    }
    if (dto.discount !== undefined) {
      product.discount = dto.discount.toFixed(2);
    }
    if (dto.featured !== undefined) {
      product.isFeatured = dto.featured;
    }
    if (dto.sortOrder !== undefined) {
      product.sortOrder = dto.sortOrder;
    }
    if (dto.isActive !== undefined) {
      product.isActive = dto.isActive;
    }

    const saved = await this.productRepository.save(product);
    this.revalidationService.notify(PRODUCT_REVALIDATE_TAGS);
    return saved;
  }

  async remove(id: string): Promise<void> {
    const product = await this.findOne(id);
    // Block deletion while the product still holds physical stock anywhere —
    // kardists must zero it out (out/transfer) first so inventory stays honest.
    const [row]: { total: number }[] =
      await this.productRepository.manager.query(
        `SELECT COALESCE(SUM(i.quantity), 0)::int AS total
           FROM inventory i
          WHERE i.product_id = $1`,
        [product.id],
      );
    if (Number(row?.total ?? 0) > 0) {
      throw new ConflictException(
        'No se puede eliminar un producto con existencias. Ajusta el stock a 0 en todos los almacenes antes de eliminarlo.',
      );
    }
    await this.productRepository.softDelete(product.id);
    this.revalidationService.notify(PRODUCT_REVALIDATE_TAGS);
  }

  // ---------------- Internal helpers ----------------

  private async guardDuplicateSku(
    sku: string,
    excludeId?: string,
  ): Promise<void> {
    const existing = await this.productRepository.findOne({
      where: { sku },
      withDeleted: true,
    });
    if (existing && existing.id !== excludeId) {
      throw new ConflictException(`A product with SKU "${sku}" already exists`);
    }
  }

  private async generateUniqueSku(rawValue: string): Promise<string> {
    const base = slugify(rawValue).toUpperCase() || 'SKU';
    let candidate = base;
    let suffix = 2;

    while (true) {
      const existing = await this.productRepository.findOne({
        where: { sku: candidate },
        withDeleted: true,
      });
      if (!existing) {
        return candidate;
      }
      candidate = `${base}-${suffix}`;
      suffix += 1;
    }
  }

  private async ensureUniqueSlug(
    rawValue: string,
    excludeId?: string,
  ): Promise<string> {
    const slug = slugify(rawValue);
    let candidate = slug;
    let suffix = 2;

    while (true) {
      const existing = await this.productRepository.findOne({
        where: { slug: candidate },
        withDeleted: true,
      });

      if (!existing || existing.id === excludeId) {
        return candidate;
      }

      candidate = `${slug}-${suffix}`;
      suffix += 1;
    }
  }
}
