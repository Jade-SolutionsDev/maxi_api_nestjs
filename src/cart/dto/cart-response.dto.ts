import { Product } from '../../products/entities/product.entity';
import { CartItem } from '../entities/cart-item.entity';

// All money figures are calculated server-side from the live product at read
// time — the cart never stores prices, so they can't go stale.
export class CartItemResponseDto {
  productId: string;
  name: string;
  slug: string;
  imageUrl: string | null;
  format: string | null;
  measureUnit: string;
  quantity: number;
  /** Current discounted unit price (finalPrice), recalculated on every read. */
  unitPrice: number;
  /** unitPrice * quantity, rounded to cents. */
  lineTotal: number;
  /** Current sellable stock across all storages, net of order reservations. */
  available: number;
  /**
   * false when the product was deactivated/removed or stock dropped below the
   * cart quantity. The line is reported as-is, never silently mutated.
   */
  isAvailable: boolean;

  static fromEntity(item: CartItem, available: number): CartItemResponseDto {
    const product = item.product as Product;
    const dto = new CartItemResponseDto();
    const basePrice = Number(product.basePrice);
    const discount = Number(product.discount);
    dto.productId = item.productId;
    dto.name = product.name;
    dto.slug = product.slug;
    dto.imageUrl = product.imageUrl;
    dto.format = product.format;
    dto.measureUnit = product.measureUnit;
    dto.quantity = item.quantity;
    // Same formula as ProductResponseDto.fromEntity.
    dto.unitPrice = Math.round(basePrice * (1 - discount / 100) * 100) / 100;
    dto.lineTotal = Math.round(dto.unitPrice * item.quantity * 100) / 100;
    dto.available = available;
    dto.isAvailable =
      product.isActive && !product.deletedAt && available >= item.quantity;
    return dto;
  }
}

export class CartResponseDto {
  items: CartItemResponseDto[];
  /** Sum of line quantities. */
  totalItems: number;
  /** Sum of lineTotals, rounded to cents. No taxes/shipping yet. */
  subtotal: number;

  static fromItems(items: CartItemResponseDto[]): CartResponseDto {
    const dto = new CartResponseDto();
    dto.items = items;
    dto.totalItems = items.reduce((sum, i) => sum + i.quantity, 0);
    dto.subtotal =
      Math.round(items.reduce((sum, i) => sum + i.lineTotal, 0) * 100) / 100;
    return dto;
  }
}
