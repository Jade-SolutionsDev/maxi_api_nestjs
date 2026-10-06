import type { EntityManager, Repository } from 'typeorm';
import { devolverAlCarrito, quitarDelCarrito } from './devolver-al-carrito';
import { CartItem } from './entities/cart-item.entity';

/**
 * MxH-0099: el carrito no se pierde porque el pedido no llegue a cobrarse.
 *
 * Se vacía al CREAR el pedido —correcto mientras el pedido viva, porque las
 * unidades están reservadas a su nombre—, y hasta ahora se quedaba vacío cuando
 * ese pedido caducaba o se cancelaba: el cliente tenía que armar la compra otra
 * vez desde el catálogo.
 */
const carritoFalso = (filas: Partial<CartItem>[]) => {
  const guardados: CartItem[] = [];
  const borrados: CartItem[] = [];
  const repo = {
    find: jest.fn().mockResolvedValue(filas),
    create: jest.fn((datos: Partial<CartItem>) => datos as CartItem),
    save: jest.fn((items: CartItem[]) => {
      guardados.push(...items);
      return Promise.resolve(items);
    }),
    remove: jest.fn((items: CartItem[]) => {
      borrados.push(...items);
      return Promise.resolve(items);
    }),
  } as unknown as Repository<CartItem>;
  const manager = {
    getRepository: jest.fn().mockReturnValue(repo),
  } as unknown as EntityManager;
  return { manager, repo, guardados, borrados };
};

describe('devolverAlCarrito', () => {
  it('devuelve las líneas del pedido a un carrito vacío', async () => {
    const { manager, guardados } = carritoFalso([]);

    const tocadas = await devolverAlCarrito(manager, 'cliente-1', [
      { productId: 'ibc-diesel', quantity: 2 },
      { productId: 'panel-solar', quantity: 1 },
    ]);

    expect(tocadas).toBe(2);
    expect(guardados).toEqual([
      { clientId: 'cliente-1', productId: 'ibc-diesel', quantity: 2 },
      { clientId: 'cliente-1', productId: 'panel-solar', quantity: 1 },
    ]);
  });

  /**
   * El caso que describe la tarjeta: el cliente creyó que había perdido el
   * carrito y lo rearmó a mano. Sumar le dejaría el doble de todo.
   */
  it('se queda con la cantidad mayor, no con la suma', async () => {
    const existente = {
      id: 'linea-1',
      clientId: 'cliente-1',
      productId: 'ibc-diesel',
      quantity: 2,
    } as CartItem;
    const { manager, guardados } = carritoFalso([existente]);

    await devolverAlCarrito(manager, 'cliente-1', [
      { productId: 'ibc-diesel', quantity: 2 },
    ]);

    expect(guardados).toHaveLength(0);
    expect(existente.quantity).toBe(2);
  });

  it('sube la cantidad cuando el pedido traía más', async () => {
    const existente = {
      clientId: 'cliente-1',
      productId: 'ibc-diesel',
      quantity: 1,
    } as CartItem;
    const { manager } = carritoFalso([existente]);

    await devolverAlCarrito(manager, 'cliente-1', [
      { productId: 'ibc-diesel', quantity: 3 },
    ]);

    expect(existente.quantity).toBe(3);
  });

  it('no toca la base si el pedido no tenía líneas', async () => {
    const { manager, repo } = carritoFalso([]);

    expect(await devolverAlCarrito(manager, 'cliente-1', [])).toBe(0);
    expect(repo.find).not.toHaveBeenCalled();
  });

  it('ignora cantidades que no suman nada', async () => {
    const { manager, guardados } = carritoFalso([]);

    await devolverAlCarrito(manager, 'cliente-1', [
      { productId: 'ibc-diesel', quantity: 0 },
    ]);

    expect(guardados).toHaveLength(0);
  });
});

describe('quitarDelCarrito', () => {
  it('saca lo que el pedido revivido se lleva', async () => {
    const existente = {
      clientId: 'cliente-1',
      productId: 'ibc-diesel',
      quantity: 2,
    } as CartItem;
    const { manager, borrados } = carritoFalso([existente]);

    await quitarDelCarrito(manager, 'cliente-1', [
      { productId: 'ibc-diesel', quantity: 2 },
    ]);

    expect(borrados).toEqual([existente]);
  });

  it('respeta lo que el cliente añadió mientras esperaba', async () => {
    const existente = {
      clientId: 'cliente-1',
      productId: 'ibc-diesel',
      quantity: 5,
    } as CartItem;
    const { manager, borrados } = carritoFalso([existente]);

    await quitarDelCarrito(manager, 'cliente-1', [
      { productId: 'ibc-diesel', quantity: 2 },
    ]);

    expect(borrados).toHaveLength(0);
    expect(existente.quantity).toBe(3);
  });

  it('no se inventa líneas que el carrito no tiene', async () => {
    const { manager, guardados, borrados } = carritoFalso([]);

    expect(
      await quitarDelCarrito(manager, 'cliente-1', [
        { productId: 'ibc-diesel', quantity: 2 },
      ]),
    ).toBe(0);
    expect(guardados).toHaveLength(0);
    expect(borrados).toHaveLength(0);
  });
});
