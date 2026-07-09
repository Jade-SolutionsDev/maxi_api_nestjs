import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CategoriesService } from '../categories/categories.service';
import { Category } from '../categories/entities/category.entity';
import { Role, User } from '../users/entities/user.entity';
import { Product } from './entities/product.entity';
import { ProductsService } from './products.service';

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    clerkId: 'clerk_provider',
    role: Role.GROCER,
    email: 'provider@example.com',
    firstName: 'Prov',
    lastName: 'Ider',
    phone: null,
    avatarUrl: null,
    businessName: null,
    businessDescription: null,
    businessLogoUrl: null,
    clerkOrgId: null,
    isActive: true,
    createdBy: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    ...overrides,
  };
}

function makeChildCategory(overrides: Partial<Category> = {}): Category {
  return {
    id: 'cat-1',
    providerId: '11111111-1111-1111-1111-111111111111',
    parentId: 'dep-1',
    name: 'Refrescos',
    slug: 'refrescos',
    description: null,
    sortOrder: 0,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    ...overrides,
  };
}

function makeProduct(overrides: Partial<Product> = {}): Product {
  return {
    id: 'prod-1',
    providerId: '11111111-1111-1111-1111-111111111111',
    categoryId: 'cat-1',
    sku: 'SKU-1',
    name: 'Cola 1L',
    slug: 'cola-1l',
    description: null,
    basePrice: '9.99',
    unit: 'unidad',
    images: [],
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    ...overrides,
  };
}

describe('ProductsService', () => {
  let service: ProductsService;
  let repository: jest.Mocked<Repository<Product>>;
  let categoriesService: { getOwnedChildCategoryOrThrow: jest.Mock };
  const provider = makeUser();

  beforeEach(async () => {
    categoriesService = { getOwnedChildCategoryOrThrow: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProductsService,
        {
          provide: getRepositoryToken(Product),
          useValue: {
            find: jest.fn(),
            findOne: jest.fn(),
            count: jest.fn(),
            create: jest.fn(),
            save: jest.fn(),
            softDelete: jest.fn(),
          },
        },
        { provide: CategoriesService, useValue: categoriesService },
      ],
    }).compile();

    service = module.get<ProductsService>(ProductsService);
    repository = module.get(getRepositoryToken(Product));
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    it('creates a product inside an owned child category', async () => {
      categoriesService.getOwnedChildCategoryOrThrow.mockResolvedValue(
        makeChildCategory(),
      );
      repository.findOne.mockResolvedValue(null); // sku + slug unique
      repository.create.mockImplementation((data) => data as Product);
      repository.save.mockImplementation((p) => Promise.resolve(p as Product));

      const result = await service.create(provider, {
        categoryId: 'cat-1',
        sku: 'SKU-1',
        name: 'Cola 1L',
        basePrice: 9.99,
      });

      expect(result.providerId).toBe(provider.id);
      expect(result.categoryId).toBe('cat-1');
      expect(result.basePrice).toBe('9.99');
      expect(result.slug).toBe('cola-1l');
    });

    it('propagates BadRequest when category is a department', async () => {
      categoriesService.getOwnedChildCategoryOrThrow.mockRejectedValue(
        new BadRequestException('is a department'),
      );

      await expect(
        service.create(provider, {
          categoryId: 'dep-1',
          sku: 'SKU-2',
          name: 'Cola',
          basePrice: 5,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('throws Conflict on duplicate SKU', async () => {
      categoriesService.getOwnedChildCategoryOrThrow.mockResolvedValue(
        makeChildCategory(),
      );
      repository.findOne.mockResolvedValue(makeProduct()); // existing sku

      await expect(
        service.create(provider, {
          categoryId: 'cat-1',
          sku: 'SKU-1',
          name: 'Cola 1L',
          basePrice: 9.99,
        }),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('findOne', () => {
    it('throws NotFound when product is missing (or not owned)', async () => {
      repository.findOne.mockResolvedValue(null);
      await expect(service.findOne(provider, 'missing')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('remove', () => {
    it('soft-deletes an owned product', async () => {
      repository.findOne.mockResolvedValue(makeProduct());
      repository.softDelete.mockResolvedValue({
        affected: 1,
        raw: [],
        generatedMaps: [],
      });

      await service.remove(provider, 'prod-1');
      expect(repository.softDelete).toHaveBeenCalledWith('prod-1');
    });
  });
});
