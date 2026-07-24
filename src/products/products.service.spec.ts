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
            manager: { query: jest.fn() },
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

  describe('findStorefront', () => {
    it('returns only in-stock products with their total stock', async () => {
      jest
        .spyOn(service, 'findAll')
        .mockResolvedValue([
          makeProduct({ id: 'p1' }),
          makeProduct({ id: 'p2' }),
          makeProduct({ id: 'p3' }),
        ]);
      jest.spyOn(service, 'availableFor').mockResolvedValue(
        new Map([
          ['p1', 5],
          ['p2', 0],
          ['p3', 12],
        ]),
      );

      const rows = await service.findStorefront({});

      // p2 (0 stock) dropped; p1 and p3 remain (pagination happens in the controller).
      expect(rows).toEqual([
        { product: expect.objectContaining({ id: 'p1' }), stock: 5 },
        { product: expect.objectContaining({ id: 'p3' }), stock: 12 },
      ]);
    });

    it('includeOutOfStock keeps zero-stock products', async () => {
      jest
        .spyOn(service, 'findAll')
        .mockResolvedValue([
          makeProduct({ id: 'p1' }),
          makeProduct({ id: 'p2' }),
        ]);
      jest.spyOn(service, 'availableFor').mockResolvedValue(
        new Map([
          ['p1', 0],
          ['p2', 3],
        ]),
      );

      const rows = await service.findStorefront(
        {},
        { includeOutOfStock: true },
      );
      expect(rows.map((r) => r.stock)).toEqual([0, 3]);
    });

    it('uses location-specific stock when locationId is given', async () => {
      jest
        .spyOn(service, 'findAll')
        .mockResolvedValue([makeProduct({ id: 'p1' })]);
      const amountsSpy = jest.spyOn(service, 'availableFor');
      repository.manager.query = jest
        .fn()
        .mockResolvedValue([{ product_id: 'p1', total: 7 }]);

      const rows = await service.findStorefront({}, { locationId: 'loc-1' });

      expect(rows).toEqual([
        { product: expect.objectContaining({ id: 'p1' }), stock: 7 },
      ]);
      expect(amountsSpy).not.toHaveBeenCalled(); // location path bypasses the all-storages sum
      expect(repository.manager.query).toHaveBeenCalledWith(
        expect.stringContaining('location_id = $1'),
        ['loc-1', ['p1']],
      );
    });

    it('forces isActive=true so inactive products never reach the storefront', async () => {
      const findAllSpy = jest.spyOn(service, 'findAll').mockResolvedValue([]);
      jest.spyOn(service, 'availableFor').mockResolvedValue(new Map());

      await service.findStorefront({ featured: true });

      expect(findAllSpy).toHaveBeenCalledWith(
        expect.objectContaining({ featured: true, isActive: true }),
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
