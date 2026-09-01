import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ILike, IsNull, Not, Repository } from 'typeorm';
import { Product } from '../products/entities/product.entity';
import { Role, User } from '../users/entities/user.entity';
import { RevalidationService } from '../revalidation/revalidation.service';
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
    parentId: null,
    name: 'Electrodomesticos',
    slug: 'electrodomesticos',
    description: null,
    imageDesktopUrl: null,
    imageMobileUrl: null,
    isFeatured: false,
    sortOrder: 0,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    ...overrides,
  };
}

/** Minimal chainable QueryBuilder stub returning the given rows from getMany(). */
function makeQueryBuilderStub(rows: Category[]) {
  const qb = {
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    addOrderBy: jest.fn().mockReturnThis(),
    getMany: jest.fn().mockResolvedValue(rows),
  };
  return qb;
}

/** Chainable stub for the raw grouped count queries (getRawMany). */
function makeRawQueryBuilderStub(rawRows: { id: string; count: string }[]) {
  return {
    select: jest.fn().mockReturnThis(),
    addSelect: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    groupBy: jest.fn().mockReturnThis(),
    getRawMany: jest.fn().mockResolvedValue(rawRows),
  };
}

/**
 * Compara la intencion, no el objeto: dos llamadas a `contieneSinTildes` traen
 * funciones distintas y `toEqual` las mira por identidad.
 */
const esperarBusquedaSinTildes = (operador: any, termino: string) => {
  expect(operador._type).toBe('raw');
  expect(operador._getSql('tabla.columna')).toContain('f_unaccent');
  expect(operador._objectLiteralParameters).toEqual({ termino: `%${termino}%` });
};

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
            createQueryBuilder: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(Product),
          useValue: {
            count: jest.fn(),
            createQueryBuilder: jest.fn(),
          },
        },
        { provide: RevalidationService, useValue: { notify: jest.fn() } },
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
    it('creates a top-level (parentless) department', async () => {
      repository.findOne.mockResolvedValue(null); // slug is unique
      repository.create.mockImplementation((data) => data as Category);
      repository.save.mockImplementation((c) => Promise.resolve(c as Category));

      const result = await service.createDepartment(provider, {
        name: 'Bebidas',
        imageDesktopUrl: 'https://cdn/desktop.png',
        imageMobileUrl: 'https://cdn/mobile.png',
        isFeatured: true,
      });

      expect(result.parentId).toBeNull();
      expect(result.slug).toBe('bebidas');
      expect(result.imageDesktopUrl).toBe('https://cdn/desktop.png');
      expect(result.imageMobileUrl).toBe('https://cdn/mobile.png');
      expect(result.isFeatured).toBe(true);
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
    it('creates a child category under a department', async () => {
      const department = makeCategory({ id: 'dep-1', parentId: null });
      repository.findOne
        .mockResolvedValueOnce(department) // getDepartment lookup
        .mockResolvedValueOnce(null); // slug uniqueness
      repository.create.mockImplementation((data) => data as Category);
      repository.save.mockImplementation((c) => Promise.resolve(c as Category));

      const result = await service.createCategory(provider, {
        departmentId: 'dep-1',
        name: 'Refrescos',
        imageDesktopUrl: 'https://cdn/cat.png',
      });

      expect(result.parentId).toBe('dep-1');
      expect(result.imageDesktopUrl).toBe('https://cdn/cat.png');
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

  describe('search (q filter)', () => {
    it('lists all departments when q is absent', async () => {
      repository.find.mockResolvedValue([]);
      await service.listDepartments();
      expect(repository.find).toHaveBeenCalledWith(
        expect.objectContaining({ where: { parentId: IsNull() } }),
      );
    });

    it('ignores a blank q', async () => {
      repository.find.mockResolvedValue([]);
      await service.listDepartments('   ');
      expect(repository.find).toHaveBeenCalledWith(
        expect.objectContaining({ where: { parentId: IsNull() } }),
      );
    });

    it('filters departments by name OR slug, accents folded, when q is present', async () => {
      repository.find.mockResolvedValue([]);
      await service.listDepartments('ques');
      const where = repository.find.mock.calls[0][0].where;
      expect(where).toHaveLength(2);
      expect(where[0].parentId).toEqual(IsNull());
      expect(where[1].parentId).toEqual(IsNull());
      esperarBusquedaSinTildes(where[0].name, 'ques');
      esperarBusquedaSinTildes(where[1].slug, 'ques');
    });

    it('filters categories by name OR slug, accents folded, when q is present', async () => {
      repository.find.mockResolvedValue([]);
      await service.listCategories(provider, undefined, 'ques');
      const where = repository.find.mock.calls[0][0].where;
      expect(where).toHaveLength(2);
      expect(where[0].parentId).toEqual(Not(IsNull()));
      expect(where[1].parentId).toEqual(Not(IsNull()));
      esperarBusquedaSinTildes(where[0].name, 'ques');
      esperarBusquedaSinTildes(where[1].slug, 'ques');
    });
  });

  describe('getChildCategoryOrThrow', () => {
    it('returns a child category', async () => {
      const child = makeCategory({ id: 'cat-1', parentId: 'dep-1' });
      repository.findOne.mockResolvedValue(child);
      const result = await service.getChildCategoryOrThrow('cat-1');
      expect(result).toBe(child);
    });

    it('rejects a department (top-level category)', async () => {
      repository.findOne.mockResolvedValue(
        makeCategory({ id: 'dep-1', parentId: null }),
      );
      await expect(
        service.getChildCategoryOrThrow('dep-1'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('public reads', () => {
    it('listPublicDepartments always filters by stock validity + optional featured', async () => {
      const rows = [makeCategory({ id: 'dep-1', isFeatured: true })];
      const qb = makeQueryBuilderStub(rows);
      repository.createQueryBuilder.mockReturnValue(qb as never);

      const result = await service.listPublicDepartments({ featured: true });

      expect(result).toBe(rows);
      // Validity EXISTS is always applied (stock-aware, references inventory).
      expect(qb.andWhere).toHaveBeenCalledWith(
        expect.stringContaining('inventory'),
      );
      expect(qb.andWhere).toHaveBeenCalledWith('dep.isFeatured = :featured', {
        featured: true,
      });
    });

    it('listPublicCategories filters by stock validity even with no facets', async () => {
      const rows = [makeCategory({ id: 'cat-1', parentId: 'dep-1' })];
      const qb = makeQueryBuilderStub(rows);
      repository.createQueryBuilder.mockReturnValue(qb as never);

      const result = await service.listPublicCategories({});

      expect(result).toBe(rows);
      expect(qb.andWhere).toHaveBeenCalledWith(
        expect.stringContaining('inventory'),
      );
    });

    it('listPublicCategories counts sellable stock net of reservations', async () => {
      const qb = makeQueryBuilderStub([]);
      repository.createQueryBuilder.mockReturnValue(qb as never);

      await service.listPublicCategories({});

      expect(qb.andWhere).toHaveBeenCalledWith(
        expect.stringContaining('i.quantity - i.reserved_quantity'),
      );
      expect(qb.andWhere).toHaveBeenCalledWith(
        expect.stringContaining('stock_locations'),
      );
    });

    it('listPublicCategories scopes validity to the municipality coverage', async () => {
      const qb = makeQueryBuilderStub([]);
      repository.createQueryBuilder.mockReturnValue(qb as never);

      await service.listPublicCategories({ municipalityId: 'mun-1' });

      expect(qb.andWhere).toHaveBeenCalledWith(
        expect.stringContaining('stock_location_coverage'),
        { municipalityId: 'mun-1' },
      );
    });

    it('listPublicCategories narrows to a department when given', async () => {
      const rows = [makeCategory({ id: 'cat-1', parentId: 'dep-1' })];
      const qb = makeQueryBuilderStub(rows);
      repository.createQueryBuilder.mockReturnValue(qb as never);

      await service.listPublicCategories({ departmentId: 'dep-1' });

      expect(qb.andWhere).toHaveBeenCalledWith('cat.parentId = :departmentId', {
        departmentId: 'dep-1',
      });
    });

    it('getPublicDepartment throws NotFound for a missing/inactive department', async () => {
      repository.findOne.mockResolvedValue(null);
      await expect(service.getPublicDepartment('nope')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('getPublicCategory returns an active child category', async () => {
      const cat = makeCategory({ id: 'cat-1', parentId: 'dep-1' });
      repository.findOne.mockResolvedValue(cat);
      await expect(service.getPublicCategory('cat-1')).resolves.toBe(cat);
    });

    it('countValidChildren maps departmentId -> numeric count', async () => {
      const qb = makeRawQueryBuilderStub([{ id: 'dep-1', count: '3' }]);
      repository.createQueryBuilder.mockReturnValue(qb as never);

      const map = await service.countValidChildren(['dep-1', 'dep-2']);

      expect(map.get('dep-1')).toBe(3);
      expect(map.get('dep-2')).toBeUndefined(); // no products -> absent
    });

    it('countValidProducts maps categoryId -> numeric count', async () => {
      const qb = makeRawQueryBuilderStub([{ id: 'cat-1', count: '7' }]);
      productRepository.createQueryBuilder.mockReturnValue(qb as never);

      const map = await service.countValidProducts(['cat-1']);

      expect(map.get('cat-1')).toBe(7);
    });

    it('countValidProducts binds the municipality when scoped', async () => {
      const qb = makeRawQueryBuilderStub([{ id: 'cat-1', count: '1' }]);
      productRepository.createQueryBuilder.mockReturnValue(qb as never);

      await service.countValidProducts(['cat-1'], 'mun-1');

      expect(qb.andWhere).toHaveBeenCalledWith(
        expect.stringContaining('stock_location_coverage'),
        { municipalityId: 'mun-1' },
      );
    });

    it('countChildren/countProducts return backoffice totals', async () => {
      const catQb = makeRawQueryBuilderStub([{ id: 'dep-1', count: '5' }]);
      repository.createQueryBuilder.mockReturnValue(catQb as never);
      const prodQb = makeRawQueryBuilderStub([{ id: 'cat-1', count: '9' }]);
      productRepository.createQueryBuilder.mockReturnValue(prodQb as never);

      expect((await service.countChildren(['dep-1'])).get('dep-1')).toBe(5);
      expect((await service.countProducts(['cat-1'])).get('cat-1')).toBe(9);
      // Totals mirror the delete guards: no active/stock narrowing applied.
      expect(catQb.andWhere).not.toHaveBeenCalled();
      expect(prodQb.andWhere).not.toHaveBeenCalled();
    });

    it('getPublicCatalog groups categories under departments with totals', async () => {
      const depA = makeCategory({ id: 'dep-a', parentId: null });
      const depB = makeCategory({ id: 'dep-b', parentId: null });
      const catA1 = makeCategory({ id: 'cat-a1', parentId: 'dep-a' });
      const catA2 = makeCategory({ id: 'cat-a2', parentId: 'dep-a' });
      const catB1 = makeCategory({ id: 'cat-b1', parentId: 'dep-b' });

      jest
        .spyOn(service, 'listPublicDepartments')
        .mockResolvedValue([depA, depB]);
      jest
        .spyOn(service, 'listPublicCategories')
        .mockResolvedValue([catA1, catA2, catB1]);
      jest.spyOn(service, 'countValidProducts').mockResolvedValue(
        new Map([
          ['cat-a1', 84],
          ['cat-a2', 21],
          ['cat-b1', 5],
        ]),
      );

      const tree = await service.getPublicCatalog();

      expect(tree).toHaveLength(2);
      const a = tree.find((n) => n.department.id === 'dep-a')!;
      expect(a.categories.map((c) => c.category.id)).toEqual([
        'cat-a1',
        'cat-a2',
      ]);
      expect(a.productsCount).toBe(105); // 84 + 21, summed server-side
      const b = tree.find((n) => n.department.id === 'dep-b')!;
      expect(b.productsCount).toBe(5);
    });

    it('getPublicCatalog drops departments with no valid categories', async () => {
      const dep = makeCategory({ id: 'dep-empty', parentId: null });
      jest.spyOn(service, 'listPublicDepartments').mockResolvedValue([dep]);
      jest.spyOn(service, 'listPublicCategories').mockResolvedValue([]);
      jest.spyOn(service, 'countValidProducts').mockResolvedValue(new Map());

      expect(await service.getPublicCatalog()).toEqual([]);
    });

    it('count helpers short-circuit on an empty id list (no query)', async () => {
      expect((await service.countValidChildren([])).size).toBe(0);
      expect((await service.countValidProducts([])).size).toBe(0);
      expect(repository.createQueryBuilder).not.toHaveBeenCalled();
      expect(productRepository.createQueryBuilder).not.toHaveBeenCalled();
    });
  });
});
