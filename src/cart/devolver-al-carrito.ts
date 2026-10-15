import type { EntityManager } from 'typeorm';
import { CartItem } from './entities/cart-item.entity';

/** Una línea de pedido, reducida a lo que el carrito necesita. */
export interface LineaDevuelta {
  productId: string;
  quantity: number;
}

/**
 * Devuelve al carrito las líneas de un pedido que no llegó a cobrarse.
 *
 * El carrito se vacía cuando se **crea** el pedido, no cuando se paga
 * (`orders.service.ts`, dentro de la transacción del checkout), y eso es
 * correcto mientras el pedido viva: las unidades están reservadas a su nombre y
 * tenerlas también en el carrito invita a pedirlas dos veces.
 *
 * El problema es lo que pasaba después. Si el pedido no se pagaba —caducó, o el
 * cliente lo canceló—, el stock volvía a la tienda y el carrito se quedaba
 * vacío: quien había armado una compra de quince líneas tenía que armarla otra
 * vez desde el catálogo. De ahí sale `MxH-0099`. El correo de caducidad llegaba
 * a decirle «puedes hacer el pedido otra vez», que era verdad y era el
 * problema.
 *
 * **Se queda la cantidad mayor, no la suma.** Suena menos obvio de lo que es:
 * el caso frecuente es justo el que describe la tarjeta —el cliente creyó que
 * había perdido el carrito y lo rearmó a mano—, y sumar le dejaría el doble de
 * todo sin que lo pidiera. Con el máximo, en el otro caso (añadió una unidad
 * más mientras esperaba) se queda corto por una, lo ve en el carrito y lo
 * arregla en un clic. Equivocarse por defecto se corrige; por exceso se cobra.
 *
 * No valida stock ni actividad del producto a propósito: esto corre dentro de
 * la transacción que cancela el pedido y **no puede fallar**. Un producto que
 * ya no está disponible se enseña en el carrito como no disponible —
 * `CartService.getCart` lo contempla— y el checkout lo vuelve a comprobar.
 *
 * Devuelve cuántas líneas tocó, para que quien llame pueda registrarlo.
 */
export const devolverAlCarrito = async (
  manager: EntityManager,
  clientId: string,
  lineas: LineaDevuelta[],
): Promise<number> => {
  const utiles = lineas.filter((linea) => linea.quantity > 0);
  if (!utiles.length) {
    return 0;
  }

  const repo = manager.getRepository(CartItem);
  const existentes = await repo.find({ where: { clientId } });
  const porProducto = new Map(
    existentes.map((item) => [item.productId, item] as const),
  );

  // Un pedido no puede traer dos líneas del mismo producto, pero si las
  // trajera, la mayor es la que vale por lo mismo que arriba.
  const aDevolver = new Map<string, number>();
  for (const { productId, quantity } of utiles) {
    aDevolver.set(productId, Math.max(aDevolver.get(productId) ?? 0, quantity));
  }

  const porGuardar: CartItem[] = [];
  for (const [productId, quantity] of aDevolver) {
    const existente = porProducto.get(productId);
    if (!existente) {
      porGuardar.push(repo.create({ clientId, productId, quantity }));
      continue;
    }
    if (existente.quantity < quantity) {
      existente.quantity = quantity;
      porGuardar.push(existente);
    }
  }

  if (porGuardar.length) {
    await repo.save(porGuardar);
  }
  return porGuardar.length;
};

/**
 * Lo contrario: saca del carrito las líneas de un pedido que volvió a la vida.
 *
 * Hace falta por lo que arregla `devolverAlCarrito`. Si un pedido caduca, sus
 * líneas vuelven al carrito; si el cliente lo paga **después** y el stock
 * seguía ahí, el pedido se restablece (`payments.service.ts`,
 * `reinstateIfExpired`) y entonces el cliente tendría en el carrito justo lo
 * que acaba de pagar. Eso es la otra mitad del mismo problema: un carrito que
 * dice algo que no es.
 *
 * **Resta, no borra la línea entera.** Si entre la caducidad y el pago tardío
 * el cliente añadió más unidades, esas son suyas y se quedan. La línea
 * desaparece solo cuando no queda nada que no venga del pedido.
 *
 * Devuelve cuántas líneas tocó.
 */
export const quitarDelCarrito = async (
  manager: EntityManager,
  clientId: string,
  lineas: LineaDevuelta[],
): Promise<number> => {
  const utiles = lineas.filter((linea) => linea.quantity > 0);
  if (!utiles.length) {
    return 0;
  }

  const repo = manager.getRepository(CartItem);
  const existentes = await repo.find({ where: { clientId } });
  const porProducto = new Map(
    existentes.map((item) => [item.productId, item] as const),
  );

  const porGuardar: CartItem[] = [];
  const porBorrar: CartItem[] = [];
  for (const { productId, quantity } of utiles) {
    const existente = porProducto.get(productId);
    if (!existente) continue;
    const resto = existente.quantity - quantity;
    if (resto > 0) {
      existente.quantity = resto;
      porGuardar.push(existente);
    } else {
      porBorrar.push(existente);
    }
  }

  if (porGuardar.length) await repo.save(porGuardar);
  if (porBorrar.length) await repo.remove(porBorrar);
  return porGuardar.length + porBorrar.length;
};
