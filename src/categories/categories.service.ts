import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  FindOptionsWhere,
  ILike,
  IsNull,
  Not,
  Repository,
  SelectQueryBuilder,
} from 'typeorm';
import { slugify } from '../common/utils/catalog-ownership.utils';
import { Product } from '../products/entities/product.entity';
import { User } from '../users/entities/user.entity';
import { CreateCategoryDto } from './dto/create-category.dto';
import { CreateDepartmentDto } from './dto/create-department.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';
import { UpdateDepartmentDto } from './dto/update-department.dto';
import { Category } from './entities/category.entity';

/** Storefront sort fields shared by the public department/category lists. */
export type PublicSortField = 'name' | 'sortOrder' | 'createdAt';

// Departments/categories are a single GLOBAL taxonomy: no per-provider
// ownership, every authenticated user reads the same rows (writes are gated to
// admins by @Roles on the controllers).
@Injectable()
export class CategoriesService {
  constructor(
    @InjectRepository(Category)
    private readonly categoryRepository: Repository<Category>,
    @InjectRepository(Product)
    private readonly productRepository: Repository<Product>,
  ) {}

  // ---------------- Departments (parent_id = null) ----------------

  async listDepartments(q?: string): Promise<Category[]> {
    return this.categoryRepository.find({
      where: this.buildTaxonomyWhere({ parentId: IsNull() }, q),
      order: { sortOrder: 'ASC', name: 'ASC' },
    });
  }

  async getDepartment(_user: User, id: string): Promise<Category> {
    const department = await this.categoryRepository.findOne({
      where: { id, parentId: IsNull() },
    });
    if (!department) {
      throw new NotFoundException(`Department with id "${id}" not found`);
    }
    return department;
  }

  async createDepartment(
    _user: User,
    dto: CreateDepartmentDto,
  ): Promise<Category> {
    const slug = await this.ensureUniqueSlug(dto.slug ?? dto.name);

    const department = this.categoryRepository.create({
      parentId: null,
      name: dto.name,
      slug,
      description: dto.description ?? null,
      imageDesktopUrl: dto.imageDesktopUrl ?? null,
      imageMobileUrl: dto.imageMobileUrl ?? null,
      isFeatured: dto.isFeatured ?? false,
      sortOrder: dto.sortOrder ?? 0,
      isActive: dto.isActive ?? true,
    });

    return this.categoryRepository.save(department);
  }

  async updateDepartment(
    user: User,
    id: string,
    dto: UpdateDepartmentDto,
  ): Promise<Category> {
    const department = await this.getDepartment(user, id);

    if (dto.name !== undefined) {
      department.name = dto.name;
    }
    if (dto.slug !== undefined) {
      department.slug = await this.ensureUniqueSlug(dto.slug, id);
    }
    if (dto.description !== undefined) {
      department.description = dto.description;
    }
    if (dto.imageDesktopUrl !== undefined) {
      department.imageDesktopUrl = dto.imageDesktopUrl;
    }
    if (dto.imageMobileUrl !== undefined) {
      department.imageMobileUrl = dto.imageMobileUrl;
    }
    if (dto.isFeatured !== undefined) {
      department.isFeatured = dto.isFeatured;
    }
    if (dto.sortOrder !== undefined) {
      department.sortOrder = dto.sortOrder;
    }
    if (dto.isActive !== undefined) {
      department.isActive = dto.isActive;
    }

    return this.categoryRepository.save(department);
  }

  async removeDepartment(user: User, id: string): Promise<void> {
    await this.getDepartment(user, id);

    const childrenCount = await this.categoryRepository.count({
      where: { parentId: id },
      withDeleted: false,
    });

    if (childrenCount > 0) {
      throw new ConflictException(
        `Cannot delete department "${id}" because it has active categories`,
      );
    }

    await this.categoryRepository.softDelete(id);
  }

  // ---------------- Categories (parent_id = department id) ----------------

  async listCategories(
    _user: User,
    departmentId?: string,
    q?: string,
  ): Promise<Category[]> {
    const base: FindOptionsWhere<Category> = {
      parentId: departmentId ?? Not(IsNull()),
    };

    return this.categoryRepository.find({
      where: this.buildTaxonomyWhere(base, q),
      order: { sortOrder: 'ASC', name: 'ASC' },
    });
  }

  async getCategory(id: string): Promise<Category> {
    const category = await this.categoryRepository.findOne({
      where: { id },
    });
    if (!category) {
      throw new NotFoundException(`Category with id "${id}" not found`);
    }
    return category;
  }

  async createCategory(user: User, dto: CreateCategoryDto): Promise<Category> {
    // Validate the parent is a top-level department (this is what prevents
    // grandchildren — a category can only ever hang off a department).
    const department = await this.getDepartment(user, dto.departmentId);

    const slug = await this.ensureUniqueSlug(dto.slug ?? dto.name);

    const category = this.categoryRepository.create({
      parentId: department.id,
      name: dto.name,
      slug,
      description: dto.description ?? null,
      imageDesktopUrl: dto.imageDesktopUrl ?? null,
      imageMobileUrl: dto.imageMobileUrl ?? null,
      sortOrder: dto.sortOrder ?? 0,
      isActive: dto.isActive ?? true,
    });

    return this.categoryRepository.save(category);
  }

  async updateCategory(
    user: User,
    id: string,
    dto: UpdateCategoryDto,
  ): Promise<Category> {
    const category = await this.getCategory(id);

    if (dto.departmentId !== undefined) {
      // Re-parent only onto a department, never onto another category.
      const department = await this.getDepartment(user, dto.departmentId);
      category.parentId = department.id;
    }

    if (dto.name !== undefined) {
      category.name = dto.name;
    }
    if (dto.slug !== undefined) {
      category.slug = await this.ensureUniqueSlug(dto.slug, id);
    }
    if (dto.description !== undefined) {
      category.description = dto.description;
    }
    if (dto.imageDesktopUrl !== undefined) {
      category.imageDesktopUrl = dto.imageDesktopUrl;
    }
    if (dto.imageMobileUrl !== undefined) {
      category.imageMobileUrl = dto.imageMobileUrl;
    }
    if (dto.sortOrder !== undefined) {
      category.sortOrder = dto.sortOrder;
    }
    if (dto.isActive !== undefined) {
      category.isActive = dto.isActive;
    }

    return this.categoryRepository.save(category);
  }

  async removeCategory(user: User, id: string): Promise<void> {
    const category = await this.getCategory(id);

    if (category.parentId === null) {
      throw new BadRequestException(
        `Use the departments endpoint to delete department "${id}"`,
      );
    }

    const productsCount = await this.productRepository.count({
      where: { categoryId: id },
    });
    if (productsCount > 0) {
      throw new ConflictException(
        `Cannot delete category "${id}" because it has active products`,
      );
    }

    await this.categoryRepository.softDelete(id);
  }

  // ---------------- Public storefront reads (active rows only) ----------------

  // A category is "valid" (browsable in the storefront) when it has at least
  // one active, non-deleted product whose total inventory across locations is
  // positive. Reused by both public list queries; `catId` is the correlated
  // category-id column (safe: internal literals, never user input).
  private categoryHasStockSql(catId: string): string {
    return `EXISTS (
      SELECT 1 FROM products p
      WHERE p.category_id = ${catId}
        AND p.deleted_at IS NULL
        AND p.is_active = true
        AND ${this.productHasStockSql('p')}
    )`;
  }

  // A product is purchasable when its summed inventory across locations is
  // positive. `p` is the correlated products-table alias (internal literal).
  private productHasStockSql(p: string): string {
    return `(
      SELECT COALESCE(SUM(i.quantity), 0)
      FROM inventory i
      WHERE i.product_id = ${p}.id
    ) > 0`;
  }

  /** departmentId -> number of valid child categories, for the given ids. */
  async countValidChildren(
    departmentIds: string[],
  ): Promise<Map<string, number>> {
    if (departmentIds.length === 0) return new Map();
    const rows = await this.categoryRepository
      .createQueryBuilder('c')
      .select('c.parentId', 'id')
      .addSelect('COUNT(*)', 'count')
      .where('c.parentId IN (:...ids)', { ids: departmentIds })
      .andWhere('c.isActive = :active', { active: true })
      .andWhere(this.categoryHasStockSql('c.id'))
      .groupBy('c.parentId')
      .getRawMany<{ id: string; count: string }>();
    return new Map(rows.map((r) => [r.id, Number(r.count)]));
  }

  /** categoryId -> number of valid (active, in-stock) products, for the ids. */
  async countValidProducts(
    categoryIds: string[],
  ): Promise<Map<string, number>> {
    if (categoryIds.length === 0) return new Map();
    const rows = await this.productRepository
      .createQueryBuilder('p')
      .select('p.categoryId', 'id')
      .addSelect('COUNT(*)', 'count')
      .where('p.categoryId IN (:...ids)', { ids: categoryIds })
      .andWhere('p.isActive = :active', { active: true })
      .andWhere(this.productHasStockSql('p'))
      .groupBy('p.categoryId')
      .getRawMany<{ id: string; count: string }>();
    return new Map(rows.map((r) => [r.id, Number(r.count)]));
  }

  // Backoffice totals. Unlike the countValid* helpers these ignore active/stock
  // so they mirror the delete guards exactly — an admin seeing "0" must be able
  // to delete the row, and any non-zero count is what blocks the deletion.

  /** departmentId -> total (non-deleted) child categories. */
  async countChildren(departmentIds: string[]): Promise<Map<string, number>> {
    if (departmentIds.length === 0) return new Map();
    const rows = await this.categoryRepository
      .createQueryBuilder('c')
      .select('c.parentId', 'id')
      .addSelect('COUNT(*)', 'count')
      .where('c.parentId IN (:...ids)', { ids: departmentIds })
      .groupBy('c.parentId')
      .getRawMany<{ id: string; count: string }>();
    return new Map(rows.map((r) => [r.id, Number(r.count)]));
  }

  /** categoryId -> total (non-deleted) products. */
  async countProducts(categoryIds: string[]): Promise<Map<string, number>> {
    if (categoryIds.length === 0) return new Map();
    const rows = await this.productRepository
      .createQueryBuilder('p')
      .select('p.categoryId', 'id')
      .addSelect('COUNT(*)', 'count')
      .where('p.categoryId IN (:...ids)', { ids: categoryIds })
      .groupBy('p.categoryId')
      .getRawMany<{ id: string; count: string }>();
    return new Map(rows.map((r) => [r.id, Number(r.count)]));
  }

  async listPublicDepartments(filters: {
    featured?: boolean;
    sortBy?: PublicSortField;
    sortOrder?: 'asc' | 'desc';
  }): Promise<Category[]> {
    const qb = this.categoryRepository
      .createQueryBuilder('dep')
      .where('dep.parentId IS NULL')
      .andWhere('dep.isActive = :active', { active: true })
      // Valid department = has ≥1 active child category with in-stock products.
      .andWhere(
        `EXISTS (
          SELECT 1 FROM categories c
          WHERE c.parent_id = dep.id
            AND c.deleted_at IS NULL
            AND c.is_active = true
            AND ${this.categoryHasStockSql('c.id')}
        )`,
      );

    if (filters.featured) {
      qb.andWhere('dep.isFeatured = :featured', { featured: true });
    }

    this.applyPublicOrder(qb, 'dep', filters.sortBy, filters.sortOrder);
    return qb.getMany();
  }

  async getPublicDepartment(id: string): Promise<Category> {
    const department = await this.categoryRepository.findOne({
      where: { id, parentId: IsNull(), isActive: true },
    });
    if (!department) {
      throw new NotFoundException(`Department with id "${id}" not found`);
    }
    return department;
  }

  async listPublicCategories(filters: {
    departmentId?: string;
    sortBy?: PublicSortField;
    sortOrder?: 'asc' | 'desc';
  }): Promise<Category[]> {
    const qb = this.categoryRepository
      .createQueryBuilder('cat')
      .where('cat.parentId IS NOT NULL')
      .andWhere('cat.isActive = :active', { active: true })
      // Valid category = has ≥1 active product with positive stock.
      .andWhere(this.categoryHasStockSql('cat.id'));

    if (filters.departmentId) {
      qb.andWhere('cat.parentId = :departmentId', {
        departmentId: filters.departmentId,
      });
    }

    this.applyPublicOrder(qb, 'cat', filters.sortBy, filters.sortOrder);
    return qb.getMany();
  }

  // Shared storefront ordering for departments/categories. Default (no sortBy)
  // preserves the curated order: sortOrder asc, then name.
  private applyPublicOrder(
    qb: SelectQueryBuilder<Category>,
    alias: string,
    sortBy: PublicSortField | undefined,
    sortOrder: 'asc' | 'desc' | undefined,
  ): void {
    const dir = (sortOrder ?? 'asc').toUpperCase() as 'ASC' | 'DESC';
    switch (sortBy) {
      case 'name':
        qb.orderBy(`${alias}.name`, dir);
        break;
      case 'createdAt':
        qb.orderBy(`${alias}.createdAt`, dir);
        break;
      case 'sortOrder':
        qb.orderBy(`${alias}.sortOrder`, dir);
        break;
      default:
        qb.orderBy(`${alias}.sortOrder`, 'ASC').addOrderBy(
          `${alias}.name`,
          'ASC',
        );
    }
  }

  async getPublicCategory(id: string): Promise<Category> {
    const category = await this.categoryRepository.findOne({
      where: { id, parentId: Not(IsNull()), isActive: true },
    });
    if (!category) {
      throw new NotFoundException(`Category with id "${id}" not found`);
    }
    return category;
  }

  // ---------------- Shared helpers used by ProductsService ----------------

  /**
   * Returns a non-deleted child category (parentId != null). Used by
   * ProductsService to validate product.categoryId.
   */
  async getChildCategoryOrThrow(id: string): Promise<Category> {
    const category = await this.categoryRepository.findOne({
      where: { id },
    });

    if (!category) {
      throw new NotFoundException(`Category with id "${id}" not found`);
    }

    if (category.parentId === null) {
      throw new BadRequestException(
        `Category "${id}" is a department. Products must be assigned to a child category.`,
      );
    }

    return category;
  }

  // ---------------- Internal helpers ----------------

  /**
   * Optionally narrow a taxonomy list to rows whose name or slug match `%q%`
   * (case-insensitive). TypeORM ORs an array of where-objects, so the base
   * filter (parentId) is spread into each branch. Backs the global search.
   */
  private buildTaxonomyWhere(
    base: FindOptionsWhere<Category>,
    q?: string,
  ): FindOptionsWhere<Category> | FindOptionsWhere<Category>[] {
    const term = q?.trim();
    if (!term) return base;

    const like = ILike(`%${term}%`);
    return [
      { ...base, name: like },
      { ...base, slug: like },
    ];
  }

  private async ensureUniqueSlug(
    rawValue: string,
    excludeId?: string,
  ): Promise<string> {
    const slug = slugify(rawValue);
    let candidate = slug;
    let suffix = 2;

    while (true) {
      const existing = await this.categoryRepository.findOne({
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
