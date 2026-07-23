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

  /**
   * Departments, on list routes. Storefront reports only *valid* children
   * (active with in-stock products); the backoffice reports the total, which
   * is what the delete guard blocks on.
   */
  childrenCount?: number;

  /**
   * Categories, on list routes. Storefront reports only *valid* products
   * (active and in stock); the backoffice reports the total, which is what the
   * delete guard blocks on.
   */
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
