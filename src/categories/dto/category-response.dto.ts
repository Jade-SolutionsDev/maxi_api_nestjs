import { Category } from '../entities/category.entity';

export class CategoryResponseDto {
  id: string;
  parentId: string | null;
  name: string;
  slug: string;
  description: string | null;
  imageDesktopUrl: string | null;
  imageMobileUrl: string | null;
  isFeatured: boolean;
  sortOrder: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;

  /** Storefront departments only: number of valid child categories. */
  childrenCount?: number;

  /** Storefront categories only: number of active, in-stock products. */
  productsCount?: number;

  static fromEntity(category: Category): CategoryResponseDto {
    const dto = new CategoryResponseDto();
    dto.id = category.id;
    dto.parentId = category.parentId;
    dto.name = category.name;
    dto.slug = category.slug;
    dto.description = category.description;
    dto.imageDesktopUrl = category.imageDesktopUrl;
    dto.imageMobileUrl = category.imageMobileUrl;
    dto.isFeatured = category.isFeatured;
    dto.sortOrder = category.sortOrder;
    dto.isActive = category.isActive;
    dto.createdAt = category.createdAt;
    dto.updatedAt = category.updatedAt;
    return dto;
  }
}
