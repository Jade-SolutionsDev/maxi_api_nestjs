import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Product } from '../products/entities/product.entity';
import { Role, User } from '../users/entities/user.entity';
import { CategoriesService } from './categories.service';
import { Category } from './entities/category.entity';

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

function makeCategory(overrides: Partial<Category> = {}): Category {
  return {
    id: 'cat-1',
    providerId: '11111111-1111-1111-1111-111111111111',
    parentId: null,
    name: 'Electrodomesticos',
    slug: 'electrodomesticos',
    description: null,
    sortOrder: 0,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    ...overrides,
  };
}

describe('CategoriesService', () => {
  let service: CategoriesService;
  let repository: jest.Mocked<Repository<Category>>;
  let productRepository: jest.Mocked<Repository<Product>>;
  const provider = makeUser();

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CategoriesService,
        {
          provide: getRepositoryToken(Category),
          useValue: {
            find: jest.fn(),
            findOne: jest.fn(),
            count: jest.fn(),
            create: jest.fn(),
            save: jest.fn(),
            softDelete: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(Product),
          useValue: {
            count: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<CategoriesService>(CategoriesService);
    repository = module.get(getRepositoryToken(Category));
    productRepository = module.get(getRepositoryToken(Product));
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('createDepartment', () => {
    it('creates a top-level category owned by the provider', async () => {
      repository.findOne.mockResolvedValue(null); // slug is unique
      repository.create.mockImplementation((data) => data as Category);
      repository.save.mockImplementation((c) => Promise.resolve(c as Category));

      const result = await service.createDepartment(provider, {
        name: 'Bebidas',
      });

      expect(result.providerId).toBe(provider.id);
      expect(result.parentId).toBeNull();
      expect(result.slug).toBe('bebidas');
    });
  });

  describe('getDepartment', () => {
    it('throws NotFound when department is missing', async () => {
      repository.findOne.mockResolvedValue(null);
      await expect(
        service.getDepartment(provider, 'missing'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('createCategory', () => {
    it('creates a child category under a provider department', async () => {
      const department = makeCategory({ id: 'dep-1', parentId: null });
      repository.findOne
        .mockResolvedValueOnce(department) // getDepartment lookup
        .mockResolvedValueOnce(null); // slug uniqueness
      repository.create.mockImplementation((data) => data as Category);
      repository.save.mockImplementation((c) => Promise.resolve(c as Category));

      const result = await service.createCategory(provider, {
        departmentId: 'dep-1',
        name: 'Refrescos',
      });

      expect(result.parentId).toBe('dep-1');
      expect(result.providerId).toBe(provider.id);
    });

    it('throws NotFound when the department does not exist', async () => {
      repository.findOne.mockResolvedValueOnce(null);
      await expect(
        service.createCategory(provider, {
          departmentId: 'dep-x',
          name: 'Refrescos',
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('removeDepartment', () => {
    it('blocks deletion when the department has child categories', async () => {
      repository.findOne.mockResolvedValue(makeCategory({ id: 'dep-1' }));
      repository.count.mockResolvedValue(2);

      await expect(
        service.removeDepartment(provider, 'dep-1'),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(repository.softDelete).not.toHaveBeenCalled();
    });

    it('soft-deletes an empty department', async () => {
      repository.findOne.mockResolvedValue(makeCategory({ id: 'dep-1' }));
      repository.count.mockResolvedValue(0);
      repository.softDelete.mockResolvedValue({
        affected: 1,
        raw: [],
        generatedMaps: [],
      });

      await service.removeDepartment(provider, 'dep-1');
      expect(repository.softDelete).toHaveBeenCalledWith('dep-1');
    });
  });

  describe('removeCategory', () => {
    it('blocks deleting a department through the category method', async () => {
      repository.findOne.mockResolvedValue(
        makeCategory({ id: 'dep-1', parentId: null }),
      );
      await expect(
        service.removeCategory(provider, 'dep-1'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('blocks deletion when the category has products', async () => {
      repository.findOne.mockResolvedValue(
        makeCategory({ id: 'cat-1', parentId: 'dep-1' }),
      );
      productRepository.count.mockResolvedValue(3);

      await expect(
        service.removeCategory(provider, 'cat-1'),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('soft-deletes an empty child category', async () => {
      repository.findOne.mockResolvedValue(
        makeCategory({ id: 'cat-1', parentId: 'dep-1' }),
      );
      productRepository.count.mockResolvedValue(0);
      repository.softDelete.mockResolvedValue({
        affected: 1,
        raw: [],
        generatedMaps: [],
      });

      await service.removeCategory(provider, 'cat-1');
      expect(repository.softDelete).toHaveBeenCalledWith('cat-1');
    });
  });

  describe('getOwnedChildCategoryOrThrow', () => {
    it('returns a child category', async () => {
      const child = makeCategory({ id: 'cat-1', parentId: 'dep-1' });
      repository.findOne.mockResolvedValue(child);
      const result = await service.getOwnedChildCategoryOrThrow(
        provider,
        'cat-1',
      );
      expect(result).toBe(child);
    });

    it('rejects a department (top-level category)', async () => {
      repository.findOne.mockResolvedValue(
        makeCategory({ id: 'dep-1', parentId: null }),
      );
      await expect(
        service.getOwnedChildCategoryOrThrow(provider, 'dep-1'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });
});
