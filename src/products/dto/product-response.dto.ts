import { Product } from '../entities/product.entity';

export class ProductResponseDto {
  id: string;
  providerId: string;
  categoryId: string;
  sku: string;
  name: string;
  slug: string;
  description: string | null;
  basePrice: number;
  unit: string;
  images: string[];
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;

  static fromEntity(product: Product): ProductResponseDto {
    const dto = new ProductResponseDto();
    dto.id = product.id;
    dto.providerId = product.providerId;
    dto.categoryId = product.categoryId;
    dto.sku = product.sku;
    dto.name = product.name;
    dto.slug = product.slug;
    dto.description = product.description;
    dto.basePrice = Number(product.basePrice);
    dto.unit = product.unit;
    dto.images = product.images ?? [];
    dto.isActive = product.isActive;
    dto.createdAt = product.createdAt;
    dto.updatedAt = product.updatedAt;
    return dto;
  }
}
