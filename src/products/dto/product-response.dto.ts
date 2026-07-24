import { CategoryResponseDto } from '../../categories/dto/category-response.dto';
import { Product } from '../entities/product.entity';

export class ProductResponseDto {
  id: string;
  categoryId: string;
  category?: CategoryResponseDto | null;
  // The category's parent department, when the category relation is loaded
  // (findOne). Lets the edit form pre-fill the department cascade. Null in list
  // responses, which don't need it.
  departmentId: string | null;
  sku: string;
  name: string;
  slug: string;
  description: string | null;
  imageUrl: string | null;
  format: string | null;
  expiryDate: string | null;
  measureUnit: string;
  basePrice: number;
  discount: number;
  finalPrice: number;
  featured: boolean;
  sortOrder: number;
  isActive: boolean;
  // Calculated stock figures. `amount` = total physical stock summed across all
  // storages; `available` = amount minus stock held by pending orders
  // (inventory reservations). Passed in by the controller from the inventory sums.
  amount: number;
  available: number;
  createdAt: Date;
  updatedAt: Date;

  static fromEntity(
    product: Product,
    amount = 0,
    category: CategoryResponseDto | undefined,
    available = amount,
  ): ProductResponseDto {
    const dto = new ProductResponseDto();
    dto.id = product.id;
    dto.categoryId = product.categoryId;
    dto.departmentId = product.category?.parentId ?? null;
    dto.category = category;
    dto.sku = product.sku;
    dto.name = product.name;
    dto.slug = product.slug;
    dto.description = product.description;
    dto.imageUrl = product.imageUrl;
    dto.format = product.format;
    dto.expiryDate = product.expiryDate;
    dto.measureUnit = product.measureUnit;
    const basePrice = Number(product.basePrice);
    const discount = Number(product.discount);
    dto.basePrice = basePrice;
    dto.discount = discount;
    dto.finalPrice = Math.round(basePrice * (1 - discount / 100) * 100) / 100;
    dto.featured = product.isFeatured;
    dto.sortOrder = product.sortOrder;
    dto.isActive = product.isActive;
    dto.amount = amount;
    dto.available = available;
    dto.createdAt = product.createdAt;
    dto.updatedAt = product.updatedAt;
    return dto;
  }
}
