import { comoBusquedaParcial, contieneSinTildes } from './accent-insensitive';

/**
 * Quien teclea «%» en un buscador busca ese carácter, no «todo».
 *
 * En `LIKE`/`ILIKE`, `%` significa «lo que sea» y `_` «un carácter
 * cualquiera». Los buscadores pegaban el texto crudo entre dos `%`, así que
 * buscar «%» devolvía el listado entero —medido en staging el 26-sep-2026: 5
 * resultados de 5 en el listado de pedidos— y «_» encontraba cualquier cosa.
 */
describe('comoBusquedaParcial', () => {
  it('envuelve el texto normal sin tocarlo', () => {
    expect(comoBusquedaParcial('cola')).toBe('%cola%');
  });

  describe('escapa los comodines, que es el fallo que arregla', () => {
    it.each([
      ['%', '%\\%%'],
      ['_', '%\\_%'],
      ['\\', '%\\\\%'],
      ['50%', '%50\\%%'],
      ['a_b', '%a\\_b%'],
      ['100%\\_', '%100\\%\\\\\\_%'],
    ])('«%s» → «%s»', (entrada, esperado) => {
      expect(comoBusquedaParcial(entrada)).toBe(esperado);
    });
  });

  /**
   * El orden importa: si se escapara `%` antes que `\`, la barra que acabamos
   * de añadir se escaparía a su vez y el comodín volvería a quedar suelto.
   */
  it('escapa la barra antes que los comodines', () => {
    expect(comoBusquedaParcial('\\%')).toBe('%\\\\\\%%');
  });

  it('no se come las tildes ni los espacios', () => {
    expect(comoBusquedaParcial('Almacén de gas')).toBe('%Almacén de gas%');
  });

  it('aguanta el texto vacío', () => {
    expect(comoBusquedaParcial('')).toBe('%%');
  });

  /**
   * No es un agujero de seguridad y no se arregla aquí: el valor viaja como
   * parámetro, así que las comillas no cierran nada. Esto solo comprueba que
   * el escape de comodines no las toca de paso.
   */
  it('deja en paz las comillas: la inyección la para el parámetro, no esto', () => {
    expect(comoBusquedaParcial("o'brien")).toBe("%o'brien%");
    expect(comoBusquedaParcial("'; drop table orders;--")).toBe(
      "%'; drop table orders;--%",
    );
  });
});

describe('contieneSinTildes', () => {
  it('también escapa: usa la misma función', () => {
    const raw = contieneSinTildes('50%') as unknown as {
      getSql?: unknown;
      value?: unknown;
    };
    expect(JSON.stringify(raw)).toContain('50\\\\%');
  });
});
