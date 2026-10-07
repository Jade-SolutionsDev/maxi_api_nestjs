import { Raw } from 'typeorm';

/**
 * Búsquedas que no se pierden por una tilde.
 *
 * En español la mitad de lo que se busca la lleva, y quien escribe en el
 * buscador rara vez la pone: «almacen» tiene que encontrar «Almacén». La base
 * dobla los acentos por los dos lados con `f_unaccent`, la función que instala
 * la migración `UnaccentSearch`.
 */

/**
 * El texto tecleado, listo para un `ILIKE` que busca por dentro.
 *
 * **Escapa los comodines antes de envolver.** En `LIKE`/`ILIKE`, `%` significa
 * «lo que sea» y `_` «un carácter cualquiera», así que pegar el texto crudo
 * entre dos `%` traiciona a quien busca justo esos caracteres: teclear `%`
 * devolvía la lista entera y `_` encontraba cualquier cosa de esa longitud.
 *
 * El carácter de escape es `\`, el que PostgreSQL usa por defecto en `LIKE`,
 * y por eso se escapa también él mismo —primero, o se escaparían los escapes
 * que añadimos después—.
 *
 * Vive aquí y no en cada servicio a propósito: el fallo venía de copiar la
 * misma línea a cada buscador nuevo. Con una sola función, el siguiente
 * buscador lo hereda bien sin que nadie se acuerde.
 */
export const comoBusquedaParcial = (termino: string): string =>
  `%${termino.replace(/[\\%_]/g, (caracter) => `\\${caracter}`)}%`;

/** Para QueryBuilder: `qb.andWhere(sinTildes('product.name'), { q })`. */
export const sinTildes = (columna: string): string =>
  `f_unaccent(${columna}) ILIKE f_unaccent(:q)`;

/** Para SQL escrito a mano, donde el parámetro ya tiene su posición. */
export const sinTildesSql = (columna: string, parametro: string): string =>
  `f_unaccent(${columna}) ILIKE f_unaccent(${parametro})`;

/**
 * Para filtrar en memoria lo que no pasó por SQL (invitaciones pendientes,
 * listas ya cargadas): mismo criterio que `f_unaccent … ILIKE`.
 */
export const normalizarSinTildes = (texto: string | null | undefined): string =>
  (texto ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export const contieneTexto = (
  termino: string,
  ...campos: (string | null | undefined)[]
): boolean => {
  const buscado = normalizarSinTildes(termino);
  return campos.some((campo) => normalizarSinTildes(campo).includes(buscado));
};

/** Para las condiciones declarativas de TypeORM (`where: { name: … }`). */
export const contieneSinTildes = (termino: string) =>
  Raw((alias) => `f_unaccent(${alias}) ILIKE f_unaccent(:termino)`, {
    termino: comoBusquedaParcial(termino),
  });
