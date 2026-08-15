import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ProductsService, StorefrontArea } from '../products/products.service';
import { CartItemResponseDto, CartResponseDto } from './dto/cart-response.dto';
import { CartItem } from './entities/cart-item.entity';

// Account-bound storefront cart: rows are keyed by the authenticated client, so
// the cart follows the Clerk account across devices. Prices are never stored —
// every response recomputes them from the live product.
@Injectable()
export class CartService {
  constructor(
    @InjectRepository(CartItem)
    private readonly cartItemRepository: Repository<CartItem>,
    private readonly productsService: ProductsService,
  ) {}

  async getCart(
    clientId: string,
    area: StorefrontArea = {},
  ): Promise<CartResponseDto> {
    // withDeleted: soft-deleted products must still load so their lines show
    // as isAvailable=false instead of silently vanishing.
    const items = await this.cartItemRepository.find({
      where: { clientId },
      relations: { product: true },
      withDeleted: true,
      order: { createdAt: 'ASC' },
    });
    const present = items.filter((i) => i.product);
    const stock = await this.productsService.availableForArea(
      present.map((i) => i.productId),
      area,
    );
    return CartResponseDto.fromItems(
      present.map((i) =>
        CartItemResponseDto.fromEntity(i, stock.get(i.productId) ?? 0),
      ),
    );
  }

  /** Adds to the existing line quantity (or creates the line). */
  async addItem(
    clientId: string,
    productId: string,
    quantity: number,
    area: StorefrontArea = {},
  ): Promise<CartResponseDto> {
    await this.assertActiveProduct(productId);
    const existing = await this.cartItemRepository.findOne({
      where: { clientId, productId },
    });
    const newQuantity = (existing?.quantity ?? 0) + quantity;
    await this.assertStock(productId, newQuantity, area);

    await this.cartItemRepository.save(
      existing
        ? { ...existing, quantity: newQuantity }
        : this.cartItemRepository.create({
            clientId,
            productId,
            quantity: newQuantity,
          }),
    );
    return this.getCart(clientId, area);
  }

  /** Sets the absolute line quantity. */
  async updateItem(
    clientId: string,
    productId: string,
    quantity: number,
    area: StorefrontArea = {},
  ): Promise<CartResponseDto> {
    const item = await this.findItemOrThrow(clientId, productId);
    await this.assertActiveProduct(productId);
    await this.assertStock(productId, quantity, area);
    item.quantity = quantity;
    await this.cartItemRepository.save(item);
    return this.getCart(clientId, area);
  }

  async removeItem(
    clientId: string,
    productId: string,
    area: StorefrontArea = {},
  ): Promise<CartResponseDto> {
    const item = await this.findItemOrThrow(clientId, productId);
    await this.cartItemRepository.remove(item);
    return this.getCart(clientId, area);
  }

  async clear(
    clientId: string,
    area: StorefrontArea = {},
  ): Promise<CartResponseDto> {
    await this.cartItemRepository.delete({ clientId });
    return this.getCart(clientId, area);
  }

  // ---------------- Internal helpers ----------------

  private async findItemOrThrow(
    clientId: string,
    productId: string,
  ): Promise<CartItem> {
    const item = await this.cartItemRepository.findOne({
      where: { clientId, productId },
    });
    if (!item) {
      throw new NotFoundException(
        `Product with id "${productId}" is not in the cart`,
      );
    }
    return item;
  }

  // Inactive products are not part of the storefront catalog (same rule as
  // PublicProductsController.findOne) — 404, not 403.
  private async assertActiveProduct(productId: string): Promise<void> {
    const product = await this.productsService.findOne(productId);
    if (!product.isActive) {
      throw new NotFoundException(`Product with id "${productId}" not found`);
    }
  }

  private async assertStock(
    productId: string,
    requested: number,
    area: StorefrontArea = {},
  ): Promise<void> {
    // Net of pending-order reservations — reserved stock is not sellable.
    const amounts = await this.productsService.availableForArea(
      [productId],
      area,
    );
    const available = amounts.get(productId) ?? 0;
    if (requested > available) {
      // details.available lets the frontend clamp its quantity stepper.
      throw new ConflictException({
        message: `Insufficient stock: only ${available} available`,
        details: [
          {
            field: 'quantity',
            message: `Only ${available} available`,
            available,
          },
        ],
      });
    }
  }
}
