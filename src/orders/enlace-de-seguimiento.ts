/**
 * La dirección pública del seguimiento de un pedido.
 *
 * Se arma aquí y viaja montada en el pedido porque el panel no sabe cuál es la
 * dirección de la tienda: solo conoce la de la API y la de Clerk. Si lo armara
 * cada consumidor habría que configurar una variable más en el panel y repetir
 * la forma de la URL en dos sitios, que es como acaban separándose.
 *
 * Sin tienda configurada devuelve null en vez de una dirección a medias: más
 * vale que el botón de copiar no aparezca a que alguien mande a un cliente un
 * enlace roto.
 */
export const enlaceDeSeguimiento = (
  urlDeLaTienda: string | undefined | null,
  trackingId: string | null,
): string | null => {
  if (!urlDeLaTienda?.trim() || !trackingId) return null;
  return `${urlDeLaTienda.trim().replace(/\/+$/, '')}/seguimiento/${trackingId}`;
};
