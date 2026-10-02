import { Category } from './entities/category.entity';
import { CategoryResponseDto } from './dto/category-response.dto';

/**
 * Una categoría solo se ve en la tienda si está activa Y tiene al menos un
 * producto disponible. La tienda ya lo cumple —sus consultas públicas filtran
 * por existencias—, pero el panel enseñaba «Activo» en categorías que el
 * cliente no ve, y nadie podía saber cuáles eran.
 *
 * `visibleInStore` es ese cálculo hecho en el backend, que es donde la tarjeta
 * dice que tiene que hacerse: «la interfaz no deberá calcular de forma
 * independiente la disponibilidad automática».
 */
const categoria = (isActive: boolean): Category =>
  ({ id: 'c1', parentId: 'd1', name: 'Lácteos', isActive }) as Category;

describe('Visibilidad de una categoría en la tienda', () => {
  it('activa y con productos disponibles: se ve', () => {
    const dto = CategoryResponseDto.fromEntity(categoria(true), {
      productos: 5,
      disponibles: 3,
    });
    expect(dto.visibleInStore).toBe(true);
    expect(dto.productsCount).toBe(5);
    expect(dto.availableProductsCount).toBe(3);
  });

  it('activa pero sin productos disponibles: NO se ve', () => {
    // Tiene productos asociados, pero ninguno con existencias o activo.
    const dto = CategoryResponseDto.fromEntity(categoria(true), {
      productos: 4,
      disponibles: 0,
    });
    expect(dto.visibleInStore).toBe(false);
  });

  it('sin ningún producto: NO se ve', () => {
    const dto = CategoryResponseDto.fromEntity(categoria(true), {
      productos: 0,
      disponibles: 0,
    });
    expect(dto.visibleInStore).toBe(false);
  });

  it('desactivada a mano: NO se ve, aunque tenga productos', () => {
    const dto = CategoryResponseDto.fromEntity(categoria(false), {
      productos: 9,
      disponibles: 9,
    });
    expect(dto.visibleInStore).toBe(false);
  });

  it('sin conteos no se inventa la respuesta', () => {
    // En las rutas que no los calculan, el campo no viaja: más vale sin dato
    // que un `false` que el panel pintaría como «oculta».
    const dto = CategoryResponseDto.fromEntity(categoria(true));
    expect(dto.visibleInStore).toBeUndefined();
    expect(dto.availableProductsCount).toBeUndefined();
  });
});
