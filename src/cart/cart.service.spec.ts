import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Product } from '../products/entities/product.entity';
import { ProductsService } from '../products/products.service';
import { CartService } from './cart.service';
import { CartItem } from './entities/cart-item.entity';

function makeProduct(overrides: Partial<Product> = {}): Product {
  return {
    id: 'prod-1',
    categoryId: 'cat-1',
    sku: 'SKU-1',
    name: 'Cola 1L',
    slug: 'cola-1l',
    description: null,
    imageUrl: null,
    format: null,
    expiryDate: null,
    measureUnit: 'unidad',
    basePrice: '10.00',
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

function makeItem(overrides: Partial<CartItem> = {}): CartItem {
  return {
    id: 'item-1',
    clientId: 'client-1',
    productId: 'prod-1',
    product: makeProduct(),
    quantity: 2,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('CartService', () => {
  let service: CartService;
  let repository: jest.Mocked<Repository<CartItem>>;
  let productsService: { findOne: jest.Mock; availableForArea: jest.Mock };

  beforeEach(async () => {
    productsService = { findOne: jest.fn(), availableForArea: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CartService,
        {
          provide: getRepositoryToken(CartItem),
          useValue: {
            find: jest.fn().mockResolvedValue([]),
            findOne: jest.fn(),
            create: jest.fn((v: Partial<CartItem>) => v),
            save: jest.fn(),
            remove: jest.fn(),
            delete: jest.fn(),
          },
        },
        { provide: ProductsService, useValue: productsService },
      ],
    }).compile();

    service = module.get(CartService);
    repository = module.get(getRepositoryToken(CartItem));
    productsService.availableForArea.mockResolvedValue(new Map());
  });

  describe('getCart', () => {
    it('recalculates prices from the live product', async () => {
      repository.find.mockResolvedValue([
        makeItem({
          quantity: 3,
          product: makeProduct({ basePrice: '10.00', discount: '25.00' }),
        }),
      ]);
      productsService.availableForArea.mockResolvedValue(
        new Map([['prod-1', 5]]),
      );

      const cart = await service.getCart('client-1');

      expect(cart.items[0].unitPrice).toBe(7.5);
      expect(cart.items[0].lineTotal).toBe(22.5);
      expect(cart.items[0].isAvailable).toBe(true);
      expect(cart.totalItems).toBe(3);
      expect(cart.subtotal).toBe(22.5);
    });

    it('flags lines whose stock dropped below the cart quantity', async () => {
      repository.find.mockResolvedValue([makeItem({ quantity: 4 })]);
      productsService.availableForArea.mockResolvedValue(
        new Map([['prod-1', 1]]),
      );

      const cart = await service.getCart('client-1');

      expect(cart.items[0].isAvailable).toBe(false);
      expect(cart.items[0].available).toBe(1);
      // Reported, never mutated.
      expect(cart.items[0].quantity).toBe(4);
    });

    it('flags lines whose product was deactivated or soft-deleted', async () => {
      repository.find.mockResolvedValue([
        makeItem({ product: makeProduct({ isActive: false }) }),
        makeItem({
          id: 'item-2',
          productId: 'prod-2',
          product: makeProduct({ id: 'prod-2', deletedAt: new Date() }),
        }),
      ]);
      productsService.availableForArea.mockResolvedValue(
        new Map([
          ['prod-1', 99],
          ['prod-2', 99],
        ]),
      );

      const cart = await service.getCart('client-1');

      expect(cart.items.map((i) => i.isAvailable)).toEqual([false, false]);
    });
  });

  describe('addItem', () => {
    beforeEach(() => {
      productsService.findOne.mockResolvedValue(makeProduct());
      productsService.availableForArea.mockResolvedValue(
        new Map([['prod-1', 10]]),
      );
    });

    it('creates a new line', async () => {
      repository.findOne.mockResolvedValue(null);

      await service.addItem('client-1', 'prod-1', 2);

      expect(repository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          clientId: 'client-1',
          productId: 'prod-1',
          quantity: 2,
        }),
      );
    });

    it('increments an existing line', async () => {
      repository.findOne.mockResolvedValue(makeItem({ quantity: 2 }));

      await service.addItem('client-1', 'prod-1', 3);

      expect(repository.save).toHaveBeenCalledWith(
        expect.objectContaining({ quantity: 5 }),
      );
    });

    it('rejects with 409 when the resulting quantity exceeds stock', async () => {
      repository.findOne.mockResolvedValue(makeItem({ quantity: 8 }));

      await expect(service.addItem('client-1', 'prod-1', 3)).rejects.toThrow(
        ConflictException,
      );
      expect(repository.save).not.toHaveBeenCalled();
    });

    it('rejects inactive products with 404', async () => {
      productsService.findOne.mockResolvedValue(
        makeProduct({ isActive: false }),
      );

      await expect(service.addItem('client-1', 'prod-1', 1)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('updateItem', () => {
    beforeEach(() => {
      productsService.findOne.mockResolvedValue(makeProduct());
      productsService.availableForArea.mockResolvedValue(
        new Map([['prod-1', 10]]),
      );
    });

    it('sets the absolute quantity', async () => {
      repository.findOne.mockResolvedValue(makeItem({ quantity: 2 }));

      await service.updateItem('client-1', 'prod-1', 7);

      expect(repository.save).toHaveBeenCalledWith(
        expect.objectContaining({ quantity: 7 }),
      );
    });

    it('rejects with 409 when the quantity exceeds stock', async () => {
      repository.findOne.mockResolvedValue(makeItem());

      await expect(
        service.updateItem('client-1', 'prod-1', 11),
      ).rejects.toThrow(ConflictException);
    });

    it('404s when the line does not exist', async () => {
      repository.findOne.mockResolvedValue(null);

      await expect(service.updateItem('client-1', 'prod-1', 1)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('removeItem / clear', () => {
    it('removes an existing line', async () => {
      const item = makeItem();
      repository.findOne.mockResolvedValue(item);

      await service.removeItem('client-1', 'prod-1');

      expect(repository.remove).toHaveBeenCalledWith(item);
    });

    it('404s when removing an absent line', async () => {
      repository.findOne.mockResolvedValue(null);

      await expect(service.removeItem('client-1', 'prod-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('clears all lines for the client', async () => {
      await service.clear('client-1');

      expect(repository.delete).toHaveBeenCalledWith({ clientId: 'client-1' });
    });
  });
});
