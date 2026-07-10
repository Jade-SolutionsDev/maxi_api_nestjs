import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, IsNull, Not, Repository } from 'typeorm';
import { slugify } from '../common/utils/catalog-ownership.utils';
import { Product } from '../products/entities/product.entity';
import { User } from '../users/entities/user.entity';
import { CreateCategoryDto } from './dto/create-category.dto';
import { CreateDepartmentDto } from './dto/create-department.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';
import { UpdateDepartmentDto } from './dto/update-department.dto';
import { Category } from './entities/category.entity';

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

  async listDepartments(): Promise<Category[]> {
    return this.categoryRepository.find({
      where: { parentId: IsNull() },
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
  ): Promise<Category[]> {
    const where: FindOptionsWhere<Category> = {
      parentId: departmentId ?? Not(IsNull()),
    };

    return this.categoryRepository.find({
      where,
      order: { sortOrder: 'ASC', name: 'ASC' },
    });
  }

  async getCategory(_user: User, id: string): Promise<Category> {
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
    const category = await this.getCategory(user, id);

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
    const category = await this.getCategory(user, id);

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

  async listPublicDepartments(filters: {
    featured?: boolean;
    hasActiveCategories?: boolean;
  }): Promise<Category[]> {
    const qb = this.categoryRepository
      .createQueryBuilder('dep')
      .where('dep.parentId IS NULL')
      .andWhere('dep.isActive = :active', { active: true })
      .orderBy('dep.sortOrder', 'ASC')
      .addOrderBy('dep.name', 'ASC');

    if (filters.featured) {
      qb.andWhere('dep.isFeatured = :featured', { featured: true });
    }
    if (filters.hasActiveCategories) {
      // Department has ≥1 active child category that has ≥1 product.
      qb.andWhere(
        `EXISTS (
          SELECT 1 FROM categories c
          WHERE c.parent_id = dep.id
            AND c.deleted_at IS NULL
            AND c.is_active = true
            AND EXISTS (
              SELECT 1 FROM products p
              WHERE p.category_id = c.id AND p.deleted_at IS NULL
            )
        )`,
      );
    }

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
    active?: boolean;
  }): Promise<Category[]> {
    const qb = this.categoryRepository
      .createQueryBuilder('cat')
      .where('cat.parentId IS NOT NULL')
      .andWhere('cat.isActive = :active', { active: true })
      .orderBy('cat.sortOrder', 'ASC')
      .addOrderBy('cat.name', 'ASC');

    if (filters.departmentId) {
      qb.andWhere('cat.parentId = :departmentId', {
        departmentId: filters.departmentId,
      });
    }
    if (filters.active) {
      // "Active category" = has ≥1 (non-deleted) product associated.
      qb.andWhere(
        `EXISTS (
          SELECT 1 FROM products p
          WHERE p.category_id = cat.id AND p.deleted_at IS NULL
        )`,
      );
    }

    return qb.getMany();
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
