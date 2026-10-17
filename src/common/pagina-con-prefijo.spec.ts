import { repartirPagina } from './pagina-con-prefijo';

describe('repartirPagina', () => {
  it('sin prefijo se comporta como la paginación de siempre', () => {
    expect(repartirPagina(0, 1, 10)).toEqual({
      prefijoDesde: 0,
      prefijoHasta: 0,
      skip: 0,
      take: 10,
    });
    expect(repartirPagina(0, 3, 20)).toMatchObject({ skip: 40, take: 20 });
  });

  it('descuenta el prefijo del límite de la primera página', () => {
    // Es el caso real que se vio en el panel: 2 invitaciones y 10 por página
    // devolvían 12 filas bajo un rótulo que decía «1 - 10».
    expect(repartirPagina(2, 1, 10)).toEqual({
      prefijoDesde: 0,
      prefijoHasta: 2,
      skip: 0,
      take: 8,
    });
  });

  it('la segunda página empieza donde acabó la primera, no en el límite', () => {
    // La página 1 enseñó 2 invitaciones y 8 clientes: la 2 arranca en el 9.º
    // cliente, no en el 11.º.
    expect(repartirPagina(2, 2, 10)).toMatchObject({
      prefijoDesde: 2,
      prefijoHasta: 2,
      skip: 8,
      take: 10,
    });
  });

  it('un prefijo más largo que una página se reparte entre varias', () => {
    expect(repartirPagina(11, 1, 10)).toEqual({
      prefijoDesde: 0,
      prefijoHasta: 10,
      skip: 0,
      take: 0,
    });
    expect(repartirPagina(11, 2, 10)).toEqual({
      prefijoDesde: 10,
      prefijoHasta: 11,
      skip: 0,
      take: 9,
    });
  });

  it('una página más allá del prefijo no se lleva nada de él', () => {
    expect(repartirPagina(3, 5, 10)).toMatchObject({
      prefijoDesde: 3,
      prefijoHasta: 3,
      skip: 37,
      take: 10,
    });
  });

  it('ninguna página pide más filas que el límite', () => {
    for (const prefijo of [0, 1, 7, 10, 25]) {
      for (const page of [1, 2, 3, 4]) {
        const r = repartirPagina(prefijo, page, 10);
        expect(r.prefijoHasta - r.prefijoDesde + r.take).toBe(10);
      }
    }
  });
});
