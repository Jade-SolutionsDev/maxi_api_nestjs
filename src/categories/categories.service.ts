import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, IsNull, Not, Repository } from 'typeorm';
import {
  buildOwnerScope,
  resolveProviderId,
  slugify,
} from '../common/utils/catalog-ownership.utils';
import { Product } from '../products/entities/product.entity';
import { User } from '../users/entities/user.entity';
import { CreateCategoryDto } from './dto/create-category.dto';
import { CreateDepartmentDto } from './dto/create-department.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';
import { UpdateDepartmentDto } from './dto/update-department.dto';
import { Category } from './entities/category.entity';

@Injectable()
export class CategoriesService {
  constructor(
    @InjectRepository(Category)
    private readonly categoryRepository: Repository<Category>,
    @InjectRepository(Product)
    private readonly productRepository: Repository<Product>,
  ) {}

  // ---------------- Departments (parent_id = null) ----------------

  async listDepartments(user: User): Promise<Category[]> {
    return this.categoryRepository.find({
      where: { ...this.ownerScope(user), parentId: IsNull() },
      order: { sortOrder: 'ASC', name: 'ASC' },
    });
  }

  async getDepartment(user: User, id: string): Promise<Category> {
    const department = await this.categoryRepository.findOne({
      where: { id, ...this.ownerScope(user), parentId: IsNull() },
    });
    if (!department) {
      throw new NotFoundException(`Department with id "${id}" not found`);
    }
    return department;
  }

  async createDepartment(
    user: User,
    dto: CreateDepartmentDto,
  ): Promise<Category> {
    const providerId = resolveProviderId(user, dto.providerId);
    const slug = await this.ensureUniqueSlug(providerId, dto.slug ?? dto.name);

    const department = this.categoryRepository.create({
      providerId,
      parentId: null,
      name: dto.name,
      slug,
      description: dto.description ?? null,
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
      department.slug = await this.ensureUniqueSlug(
        department.providerId,
        dto.slug,
        id,
      );
    }
    if (dto.description !== undefined) {
      department.description = dto.description;
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
    const department = await this.getDepartment(user, id);

    const childrenCount = await this.categoryRepository.count({
      where: {
        providerId: department.providerId,
        parentId: id,
      },
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

  async listCategories(user: User, departmentId?: string): Promise<Category[]> {
    const where: FindOptionsWhere<Category> = {
      ...this.ownerScope(user),
      parentId: departmentId ?? Not(IsNull()),
    };

    return this.categoryRepository.find({
      where,
      order: { sortOrder: 'ASC', name: 'ASC' },
    });
  }

  async getCategory(user: User, id: string): Promise<Category> {
    const category = await this.categoryRepository.findOne({
      where: { id, ...this.ownerScope(user) },
    });
    if (!category) {
      throw new NotFoundException(`Category with id "${id}" not found`);
    }
    return category;
  }

  async createCategory(user: User, dto: CreateCategoryDto): Promise<Category> {
    const providerId = resolveProviderId(user, dto.providerId);

    // Validate department is a top-level category of the same provider
    const department = await this.getDepartment(user, dto.departmentId);
    if (department.providerId !== providerId) {
      throw new BadRequestException(
        `Department "${dto.departmentId}" does not belong to the selected provider`,
      );
    }

    const slug = await this.ensureUniqueSlug(providerId, dto.slug ?? dto.name);

    const category = this.categoryRepository.create({
      providerId,
      parentId: department.id,
      name: dto.name,
      slug,
      description: dto.description ?? null,
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
      // Ensure new parent is a department of the same provider
      const department = await this.getDepartment(user, dto.departmentId);
      if (department.providerId !== category.providerId) {
        throw new BadRequestException(
          `Department "${dto.departmentId}" does not belong to the selected provider`,
        );
      }
      category.parentId = department.id;
    }

    if (dto.name !== undefined) {
      category.name = dto.name;
    }
    if (dto.slug !== undefined) {
      category.slug = await this.ensureUniqueSlug(
        category.providerId,
        dto.slug,
        id,
      );
    }
    if (dto.description !== undefined) {
      category.description = dto.description;
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
      where: { categoryId: id, providerId: category.providerId },
    });
    if (productsCount > 0) {
      throw new ConflictException(
        `Cannot delete category "${id}" because it has active products`,
      );
    }

    await this.categoryRepository.softDelete(id);
  }

  // ---------------- Shared helpers used by ProductsService ----------------

  /**
   * Returns a non-deleted child category (parentId != null) owned by the same user.
   * Used by ProductsService to validate product.categoryId.
   */
  async getOwnedChildCategoryOrThrow(
    user: User,
    id: string,
  ): Promise<Category> {
    const category = await this.categoryRepository.findOne({
      where: { id, ...this.ownerScope(user) },
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

  private ownerScope(user: User): FindOptionsWhere<Category> {
    return buildOwnerScope(user);
  }

  private async ensureUniqueSlug(
    providerId: string,
    rawValue: string,
    excludeId?: string,
  ): Promise<string> {
    const slug = slugify(rawValue);
    let candidate = slug;
    let suffix = 2;

    while (true) {
      const existing = await this.categoryRepository.findOne({
        where: { providerId, slug: candidate },
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
