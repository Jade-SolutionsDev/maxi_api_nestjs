import { Raw } from 'typeorm';

/**
 * Búsquedas que no se pierden por una tilde.
 *
 * En español la mitad de lo que se busca la lleva, y quien escribe en el
 * buscador rara vez la pone: «almacen» tiene que encontrar «Almacén». La base
 * dobla los acentos por los dos lados con `f_unaccent`, la función que instala
 * la migración `UnaccentSearch`.
 */

/** Para QueryBuilder: `qb.andWhere(sinTildes('product.name'), { q })`. */
export const sinTildes = (columna: string): string =>
  `f_unaccent(${columna}) ILIKE f_unaccent(:q)`;

/** Para SQL escrito a mano, donde el parámetro ya tiene su posición. */
export const sinTildesSql = (columna: string, parametro: string): string =>
  `f_unaccent(${columna}) ILIKE f_unaccent(${parametro})`;

/** Para las condiciones declarativas de TypeORM (`where: { name: … }`). */
export const contieneSinTildes = (termino: string) =>
  Raw((alias) => `f_unaccent(${alias}) ILIKE f_unaccent(:termino)`, {
    termino: `%${termino}%`,
  });
