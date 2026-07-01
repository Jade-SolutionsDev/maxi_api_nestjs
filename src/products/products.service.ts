import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, Repository } from 'typeorm';
import {
  buildOwnerScope,
  resolveProviderId,
  slugify,
} from '../common/utils/catalog-ownership.utils';
import { CategoriesService } from '../categories/categories.service';
import { User } from '../users/entities/user.entity';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { Product } from './entities/product.entity';

@Injectable()
export class ProductsService {
  constructor(
    @InjectRepository(Product)
    private readonly productRepository: Repository<Product>,
    private readonly categoriesService: CategoriesService,
  ) {}

  async findAll(user: User, categoryId?: string): Promise<Product[]> {
    const where: FindOptionsWhere<Product> = {
      ...this.ownerScope(user),
    };
    if (categoryId) {
      where.categoryId = categoryId;
    }

    return this.productRepository.find({
      where,
      order: { createdAt: 'DESC' },
    });
  }

  async findOne(user: User, id: string): Promise<Product> {
    const product = await this.productRepository.findOne({
      where: { id, ...this.ownerScope(user) },
    });
    if (!product) {
      throw new NotFoundException(`Product with id "${id}" not found`);
    }
    return product;
  }

  async create(user: User, dto: CreateProductDto): Promise<Product> {
    const providerId = resolveProviderId(user, dto.providerId);

    const category = await this.categoriesService.getOwnedChildCategoryOrThrow(
      user,
      dto.categoryId,
    );
    if (category.providerId !== providerId) {
      throw new BadRequestException(
        `Category "${dto.categoryId}" does not belong to the selected provider`,
      );
    }

    await this.guardDuplicateSku(providerId, dto.sku);

    const slug = await this.ensureUniqueSlug(providerId, dto.slug ?? dto.name);

    const product = this.productRepository.create({
      providerId,
      categoryId: category.id,
      sku: dto.sku.trim(),
      name: dto.name,
      slug,
      description: dto.description ?? null,
      basePrice: dto.basePrice.toFixed(2),
      unit: dto.unit ?? 'unidad',
      images: dto.images ?? [],
      isActive: dto.isActive ?? true,
    });

    return this.productRepository.save(product);
  }

  async update(
    user: User,
    id: string,
    dto: UpdateProductDto,
  ): Promise<Product> {
    const product = await this.findOne(user, id);

    if (dto.categoryId !== undefined) {
      const category =
        await this.categoriesService.getOwnedChildCategoryOrThrow(
          user,
          dto.categoryId,
        );
      if (category.providerId !== product.providerId) {
        throw new BadRequestException(
          `Category "${dto.categoryId}" does not belong to the selected provider`,
        );
      }
      product.categoryId = category.id;
    }

    if (dto.sku !== undefined) {
      await this.guardDuplicateSku(product.providerId, dto.sku, id);
      product.sku = dto.sku.trim();
    }

    if (dto.name !== undefined) {
      product.name = dto.name;
    }

    if (dto.slug !== undefined) {
      product.slug = await this.ensureUniqueSlug(
        product.providerId,
        dto.slug,
        id,
      );
    } else if (dto.name !== undefined) {
      product.slug = await this.ensureUniqueSlug(
        product.providerId,
        dto.name,
        id,
      );
    }

    if (dto.description !== undefined) {
      product.description = dto.description;
    }

    if (dto.basePrice !== undefined) {
      product.basePrice = dto.basePrice.toFixed(2);
    }

    if (dto.unit !== undefined) {
      product.unit = dto.unit;
    }

    if (dto.images !== undefined) {
      product.images = dto.images;
    }

    if (dto.isActive !== undefined) {
      product.isActive = dto.isActive;
    }

    return this.productRepository.save(product);
  }

  async remove(user: User, id: string): Promise<void> {
    const product = await this.findOne(user, id);
    await this.productRepository.softDelete(product.id);
  }

  // ---------------- Internal helpers ----------------

  private ownerScope(user: User): FindOptionsWhere<Product> {
    return buildOwnerScope(user);
  }

  private async guardDuplicateSku(
    providerId: string,
    sku: string,
    excludeId?: string,
  ): Promise<void> {
    const existing = await this.productRepository.findOne({
      where: { providerId, sku: sku.trim() },
      withDeleted: true,
    });
    if (existing && existing.id !== excludeId) {
      throw new ConflictException(
        `A product with SKU "${sku}" already exists for this provider`,
      );
    }
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
      const existing = await this.productRepository.findOne({
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
