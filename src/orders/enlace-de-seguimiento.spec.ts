import { enlaceDeSeguimiento } from './enlace-de-seguimiento';

/**
 * El panel no sabe cuál es la dirección pública de la tienda —solo conoce la de
 * la API y la de Clerk—, así que el enlace se arma aquí, donde `STOREFRONT_URL`
 * ya está configurada, y viaja montado en el pedido. Así nadie tiene que
 * configurar una variable nueva en el panel ni repetir la forma de la URL.
 */
describe('enlaceDeSeguimiento', () => {
  it('arma la dirección pública del seguimiento', () => {
    expect(enlaceDeSeguimiento('https://maxihabana.com', 'abc123')).toBe(
      'https://maxihabana.com/seguimiento/abc123',
    );
  });

  it('no deja dos barras cuando la base trae uno al final', () => {
    expect(enlaceDeSeguimiento('https://maxihabana.com/', 'abc123')).toBe(
      'https://maxihabana.com/seguimiento/abc123',
    );
  });

  it('sin pedido con enlace, no hay enlace', () => {
    expect(enlaceDeSeguimiento('https://maxihabana.com', null)).toBeNull();
  });

  it('sin tienda configurada, no se inventa una dirección', () => {
    // Antes que un enlace roto que alguien copie y mande a un cliente.
    expect(enlaceDeSeguimiento(undefined, 'abc123')).toBeNull();
    expect(enlaceDeSeguimiento('', 'abc123')).toBeNull();
  });
});
