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
import { ProductResponseDto } from './dto/product-response.dto';
import { Product } from './entities/product.entity';
import { ProductsService } from './products.service';

function makeChildCategory(overrides: Partial<Category> = {}): Category {
  return {
    id: 'cat-1',
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
  } as Category;
}

function makeProduct(overrides: Partial<Product> = {}): Product {
  return {
    id: 'prod-1',
    categoryId: 'cat-1',
    sku: 'SKU-1',
    name: 'Cola 1L',
    slug: 'cola-1l',
    description: null,
    imageUrl: 'https://cdn.example.com/cola.png',
    format: null,
    expiryDate: null,
    measureUnit: 'unidad',
    basePrice: '9.99',
    discount: '0.00',
    isFeatured: false,
    sortOrder: 0,
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
  let categoriesService: { getChildCategoryOrThrow: jest.Mock };

  beforeEach(async () => {
    categoriesService = { getChildCategoryOrThrow: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProductsService,
        {
          provide: getRepositoryToken(Product),
          useValue: {
            find: jest.fn(),
            findOne: jest.fn(),
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
    beforeEach(() => {
      repository.create.mockImplementation((data) => data as Product);
      repository.save.mockImplementation((p) => Promise.resolve(p as Product));
    });

    it('creates a product inside a child category', async () => {
      categoriesService.getChildCategoryOrThrow.mockResolvedValue(
        makeChildCategory(),
      );
      repository.findOne.mockResolvedValue(null); // sku + slug unique

      const result = await service.create({
        categoryId: 'cat-1',
        sku: 'SKU-1',
        name: 'Cola 1L',
        imageUrl: 'https://cdn.example.com/cola.png',
        basePrice: 9.99,
      });

      expect(result.categoryId).toBe('cat-1');
      expect(result.sku).toBe('SKU-1');
      expect(result.basePrice).toBe('9.99');
      expect(result.slug).toBe('cola-1l');
      expect(result.measureUnit).toBe('unidad');
    });

    it('auto-generates the SKU from the name when omitted', async () => {
      categoriesService.getChildCategoryOrThrow.mockResolvedValue(
        makeChildCategory(),
      );
      repository.findOne.mockResolvedValue(null);

      const result = await service.create({
        categoryId: 'cat-1',
        name: 'Cola 1L',
        imageUrl: 'https://cdn.example.com/cola.png',
        basePrice: 9.99,
      });

      expect(result.sku).toBe('COLA-1L');
    });

    it('creates without an image (optional while the file server is off)', async () => {
      categoriesService.getChildCategoryOrThrow.mockResolvedValue(
        makeChildCategory(),
      );
      repository.findOne.mockResolvedValue(null);

      const result = await service.create({
        categoryId: 'cat-1',
        name: 'Cola 1L',
        basePrice: 9.99,
      });

      expect(result.imageUrl).toBeNull();
    });

    it('propagates BadRequest when the category is a department', async () => {
      categoriesService.getChildCategoryOrThrow.mockRejectedValue(
        new BadRequestException('is a department'),
      );

      await expect(
        service.create({
          categoryId: 'dep-1',
          name: 'Cola',
          imageUrl: 'https://cdn.example.com/cola.png',
          basePrice: 5,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('throws Conflict on an explicit duplicate SKU', async () => {
      categoriesService.getChildCategoryOrThrow.mockResolvedValue(
        makeChildCategory(),
      );
      repository.findOne.mockResolvedValue(makeProduct()); // existing sku

      await expect(
        service.create({
          categoryId: 'cat-1',
          sku: 'SKU-1',
          name: 'Cola 1L',
          imageUrl: 'https://cdn.example.com/cola.png',
          basePrice: 9.99,
        }),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('findOne', () => {
    it('throws NotFound when the product is missing', async () => {
      repository.findOne.mockResolvedValue(null);
      await expect(service.findOne('missing')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('remove', () => {
    it('soft-deletes a product', async () => {
      repository.findOne.mockResolvedValue(makeProduct());
      repository.softDelete.mockResolvedValue({
        affected: 1,
        raw: [],
        generatedMaps: [],
      });

      await service.remove('prod-1');
      expect(repository.softDelete).toHaveBeenCalledWith('prod-1');
    });
  });
});

describe('ProductResponseDto', () => {
  it('computes finalPrice from a percentage discount', () => {
    const dto = ProductResponseDto.fromEntity(
      makeProduct({ basePrice: '100.00', discount: '15.00' }),
    );
    expect(dto.finalPrice).toBe(85);
    expect(dto.amount).toBe(0);
    expect(dto.available).toBe(0);
  });

  it('equals basePrice with no discount', () => {
    const dto = ProductResponseDto.fromEntity(
      makeProduct({ basePrice: '9.99', discount: '0.00' }),
    );
    expect(dto.finalPrice).toBe(9.99);
  });
});
