import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getMetadataArgsStorage } from 'typeorm';
import { ClientAddress } from '../../client-addresses/entities/client-address.entity';

/**
 * La entidad y la migración describen las **mismas** tres columnas en dos
 * ficheros distintos, y nada obliga a que concuerden: `synchronize` está
 * apagado, así que si una dice `numeric(9,6)` y la otra `numeric(8,6)` el
 * desajuste no aparece hasta que una coordenada se redondea de más en
 * producción, o hasta que TypeORM pide una columna que no existe.
 *
 * Esto no prueba que la migración corra —para eso hace falta un Postgres— sino
 * que las dos caras del mismo cambio siguen diciendo lo mismo.
 */
describe('CoordenadasEnLasDirecciones · la migración concuerda con la entidad', () => {
  const sql = readFileSync(
    join(__dirname, '1791000000000-CoordenadasEnLasDirecciones.ts'),
    'utf8',
  );

  const columnas = getMetadataArgsStorage().columns.filter(
    (c) => c.target === ClientAddress,
  );

  const columna = (propiedad: string) => {
    const encontrada = columnas.find((c) => c.propertyName === propiedad);
    if (!encontrada) throw new Error(`La entidad ya no declara ${propiedad}`);
    return encontrada;
  };

  /**
   * El SQL alinea los tipos en columnas para leerse de un vistazo, así que
   * comparar con un número fijo de espacios probaría el alineado y no el tipo.
   */
  const declara = (columna: string, tipo: string) =>
    new RegExp(`"${columna}"\\s+${tipo.replace(/[()]/g, '\\$&')}`).test(sql);

  it.each(['latitude', 'longitude'])(
    'declara %s como numeric(9,6) en los dos sitios',
    (propiedad) => {
      const { options } = columna(propiedad);

      expect(options.type).toBe('decimal');
      expect(options.precision).toBe(9);
      expect(options.scale).toBe(6);
      expect(declara(propiedad, 'numeric(9,6)')).toBe(true);
    },
  );

  it('declara location_source como varchar(10) en los dos sitios', () => {
    const { options } = columna('locationSource');

    expect(options.name).toBe('location_source');
    expect(options.type).toBe('varchar');
    expect(options.length).toBe(10);
    expect(declara('location_source', 'varchar(10)')).toBe(true);
  });

  // La ubicación es opcional (D-011): una columna obligatoria aquí rompería la
  // migración en cuanto hubiera una sola dirección guardada, que las hay.
  it.each(['latitude', 'longitude', 'locationSource'])(
    'deja %s nulable y sin valor por omisión',
    (propiedad) => {
      const { options } = columna(propiedad);

      expect(options.nullable).toBe(true);
      expect(options.default).toBeUndefined();
    },
  );

  it('no declara NOT NULL ni DEFAULT en el SQL', () => {
    expect(sql).not.toMatch(/numeric\(9,6\)\s+NOT NULL/i);
    expect(sql).not.toMatch(/varchar\(10\)\s+NOT NULL/i);
    expect(sql).not.toMatch(/ADD COLUMN[^,]*DEFAULT/i);
  });

  it('se puede deshacer, y quita las tres', () => {
    const vuelta = sql.slice(sql.indexOf('public async down'));

    for (const columna of ['latitude', 'longitude', 'location_source']) {
      expect(vuelta).toContain(`DROP COLUMN IF EXISTS "${columna}"`);
    }
  });
});
