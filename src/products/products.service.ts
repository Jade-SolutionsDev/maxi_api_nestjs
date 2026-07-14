import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { slugify } from '../common/utils/catalog-ownership.utils';
import { CategoriesService } from '../categories/categories.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { Product } from './entities/product.entity';

export interface ProductFilters {
  q?: string;
  departmentId?: string;
  categoryId?: string;
  minPrice?: number;
  maxPrice?: number;
  featured?: boolean;
  isActive?: boolean;
}

// Global catalog: no provider scoping. Every authenticated backoffice user can
// read; writes are gated to SUPER_ADMIN/ADMIN/KARDIST at the controller.
@Injectable()
export class ProductsService {
  constructor(
    @InjectRepository(Product)
    private readonly productRepository: Repository<Product>,
    private readonly categoriesService: CategoriesService,
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
    if (filters.q) {
      qb.andWhere('product.name ILIKE :q', { q: `%${filters.q}%` });
    }
    if (filters.minPrice != null) {
      qb.andWhere('product.basePrice >= :minPrice', {
        minPrice: filters.minPrice,
      });
    }
    if (filters.maxPrice != null) {
      qb.andWhere('product.basePrice <= :maxPrice', {
        maxPrice: filters.maxPrice,
      });
    }
    if (filters.featured != null) {
      qb.andWhere('product.isFeatured = :featured', {
        featured: filters.featured,
      });
    }
    if (filters.isActive != null) {
      qb.andWhere('product.isActive = :isActive', {
        isActive: filters.isActive,
      });
    }

    return qb
      .orderBy('product.sortOrder', 'ASC')
      .addOrderBy('product.createdAt', 'DESC')
      .getMany();
  }

  // Total physical stock per product, summed across all storages. Queries the
  // inventory table directly (raw) to avoid coupling ProductsModule to the
  // inventory entity. Products with no inventory rows are simply absent (→ 0).
  async amountsFor(productIds: string[]): Promise<Map<string, number>> {
    if (productIds.length === 0) return new Map();
    const rows: { product_id: string; total: number }[] =
      await this.productRepository.manager.query(
        `SELECT product_id, COALESCE(SUM(quantity), 0)::int AS total
           FROM inventory
          WHERE product_id = ANY($1)
          GROUP BY product_id`,
        [productIds],
      );
    return new Map(rows.map((r) => [r.product_id, Number(r.total)]));
  }

  async findOne(id: string): Promise<Product> {
    const product = await this.productRepository.findOne({ where: { id } });
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
      imageUrl: dto.imageUrl,
      format: dto.format ?? null,
      expiryDate: dto.expiryDate ?? null,
      measureUnit: dto.measureUnit ?? 'unidad',
      basePrice: dto.basePrice.toFixed(2),
      discount: (dto.discount ?? 0).toFixed(2),
      isFeatured: dto.featured ?? false,
      sortOrder: dto.sortOrder ?? 0,
      isActive: dto.isActive ?? true,
    });

    return this.productRepository.save(product);
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

    return this.productRepository.save(product);
  }

  async remove(id: string): Promise<void> {
    const product = await this.findOne(id);
    await this.productRepository.softDelete(product.id);
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
