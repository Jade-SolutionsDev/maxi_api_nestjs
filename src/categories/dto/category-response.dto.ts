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

  /**
   * Productos que el cliente puede comprar hoy: activos y con existencias. Es
   * el número que decide si la categoría aparece en la tienda, y no coincide
   * con `productsCount`, que cuenta todos los asociados.
   */
  availableProductsCount?: number;

  /**
   * Si el cliente la ve ahora mismo en la tienda. Una categoría está visible
   * cuando está activa Y tiene al menos un producto disponible; la tienda ya
   * filtra así sus consultas públicas, y esto es lo mismo dicho para el panel,
   * que hasta ahora enseñaba «Activo» en categorías que nadie veía.
   *
   * Se calcula aquí y no en el panel a propósito: la pantalla no debe deducir
   * la disponibilidad por su cuenta, porque entonces habría dos definiciones
   * de lo mismo y se separarían.
   */
  visibleInStore?: boolean;

  /**
   * `conteos` solo llega en las rutas que los calculan. Sin ellos, los tres
   * campos viajan sin valor: más vale que el panel no sepa a que crea que una
   * categoría está oculta porque nadie contó sus productos.
   */
  static fromEntity(
    category: Category,
    conteos?: { productos: number; disponibles: number },
  ): CategoryResponseDto {
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
    if (conteos) {
      dto.productsCount = conteos.productos;
      dto.availableProductsCount = conteos.disponibles;
      dto.visibleInStore = category.isActive && conteos.disponibles > 0;
    }
    return dto;
  }
}
