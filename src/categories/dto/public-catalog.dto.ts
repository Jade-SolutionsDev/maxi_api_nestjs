import { Category } from '../entities/category.entity';

// Lean, nav-oriented shape for GET /public/catalog. Deliberately a subset of
// CategoryResponseDto (no timestamps/description/flags the nav never renders) —
// this payload is fetched app-wide, so it stays small and cacheable.

export class PublicCatalogCategoryDto {
  id: string;
  name: string;
  slug: string;
  imageDesktopUrl: string | null;
  imageMobileUrl: string | null;
  sortOrder: number;
  /** Valid (active, in-stock) products in this category. */
  productsCount: number;

  static from(
    category: Category,
    productsCount: number,
  ): PublicCatalogCategoryDto {
    const dto = new PublicCatalogCategoryDto();
    dto.id = category.id;
    dto.name = category.name;
    dto.slug = category.slug;
    dto.imageDesktopUrl = category.imageDesktopUrl;
    dto.imageMobileUrl = category.imageMobileUrl;
    dto.sortOrder = category.sortOrder;
    dto.productsCount = productsCount;
    return dto;
  }
}

export class PublicCatalogDepartmentDto {
  id: string;
  name: string;
  slug: string;
  imageDesktopUrl: string | null;
  imageMobileUrl: string | null;
  sortOrder: number;
  isFeatured: boolean;
  /** Total valid products across this department's categories. */
  productsCount: number;
  categories: PublicCatalogCategoryDto[];

  static from(
    department: Category,
    productsCount: number,
    categories: PublicCatalogCategoryDto[],
  ): PublicCatalogDepartmentDto {
    const dto = new PublicCatalogDepartmentDto();
    dto.id = department.id;
    dto.name = department.name;
    dto.slug = department.slug;
    dto.imageDesktopUrl = department.imageDesktopUrl;
    dto.imageMobileUrl = department.imageMobileUrl;
    dto.sortOrder = department.sortOrder;
    dto.isFeatured = department.isFeatured;
    dto.productsCount = productsCount;
    dto.categories = categories;
    return dto;
  }
}
