/**
 * Reparte una página entre dos fuentes: un **prefijo en memoria** que va
 * siempre delante y una consulta SQL que aporta el resto.
 *
 * Los listados de clientes y de usuarios mezclan dos cosas que no viven en el
 * mismo sitio: las invitaciones pendientes, que se piden a Clerk, y las filas
 * de la tabla. Antes las invitaciones se **anteponían a la página 1** sin
 * descontarlas del límite, así que esa página devolvía `limit + pendientes`
 * filas mientras el pie seguía diciendo «1 - limit»: el panel pintaba 12 filas
 * bajo un rótulo que decía 10.
 *
 * Tratando el prefijo como las primeras posiciones de una sola lista, cada
 * página vuelve a tener exactamente `limit` filas y el rango del pie cuadra.
 * Un prefijo más largo que una página se reparte entre varias, en vez de salir
 * entero en la primera.
 */
export interface RepartoDePagina {
  /** Primer elemento del prefijo que entra en esta página. */
  prefijoDesde: number;
  /** Primero que ya no entra, para usar tal cual con `slice`. */
  prefijoHasta: number;
  /** Filas de la consulta SQL que hay que saltarse. */
  skip: number;
  /** Filas SQL que caben en lo que queda de página; `0` si no cabe ninguna. */
  take: number;
}

export function repartirPagina(
  largoDelPrefijo: number,
  page: number,
  limit: number,
): RepartoDePagina {
  const desde = (page - 1) * limit;
  const prefijoDesde = Math.min(desde, largoDelPrefijo);
  const prefijoHasta = Math.min(desde + limit, largoDelPrefijo);

  return {
    prefijoDesde,
    prefijoHasta,
    // Lo que el prefijo ya ocupó de la lista global no se le pide al SQL.
    skip: Math.max(0, desde - largoDelPrefijo),
    take: limit - (prefijoHasta - prefijoDesde),
  };
}
