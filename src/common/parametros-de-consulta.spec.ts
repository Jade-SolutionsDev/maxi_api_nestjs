import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Un parámetro de consulta declarado como obligatorio tiene que validarse: con
 * un tubo, o recogiéndolo en un DTO.
 *
 * **Qué pasa si no** (MxH-0181). `@Query('clerkId') clerkId: string` dice
 * `string`, así que TypeScript cree que nunca falta — pero quien manda la
 * petición decide si lo manda, y si no lo manda llega `undefined`. En
 * `/clients/lookup` y `/users/lookup` ese `undefined` entraba en el `where` de
 * TypeORM, que se niega a construirlo y lanza: **500 a una petición que venía
 * mal**. El tipo declarado era una promesa que nadie comprobaba.
 *
 * **Por qué una guardia aparte y no la de los parámetros de ruta.** Lo que se
 * mide aquí es una **declaración de tipo**, y eso solo existe en el código
 * fuente: los metadatos de Nest guardan el nombre y los tubos, no si el
 * parámetro era opcional. Así que esta prueba sí lee el texto, y hay que
 * saberlo: mide el formato tanto como el comportamiento, y una firma escrita de
 * una forma rara puede escapársele. La hermana —`identificadores-de-ruta`—
 * mide los metadatos, que es lo correcto para los tubos de la ruta.
 *
 * Un parámetro **opcional** (`todos?: string`) no entra aquí: quien lo declara
 * así ya está obligado por el tipo a tratar el `undefined`.
 */

/** `fichero:parámetro` → por qué ese sí puede llegar sin validar. */
const SIN_VALIDAR: Map<string, string> = new Map([]);

const controladores = (dir: string): string[] =>
  readdirSync(dir).flatMap((nombre) => {
    const ruta = join(dir, nombre);
    if (statSync(ruta).isDirectory()) return controladores(ruta);
    return nombre.endsWith('.controller.ts') ? [ruta] : [];
  });

/**
 * `@Query('nombre') nombre: string` — sin tubo y sin `?`. El `(?!,)` tras el
 * nombre del parámetro es lo que distingue «sin tubo» de «con tubo»: con tubo,
 * el paréntesis del decorador lleva una coma dentro.
 */
const OBLIGATORIO_Y_SIN_TUBO =
  /@Query\(\s*'([^']+)'\s*\)\s*(\w+)\s*:\s*(?:string|number)\s*[,)]/g;

const hallazgos = (): string[] => {
  const salida: string[] = [];
  for (const fichero of controladores(join(__dirname, '..'))) {
    const texto = readFileSync(fichero, 'utf8');
    for (const encontrado of texto.matchAll(OBLIGATORIO_Y_SIN_TUBO)) {
      const relativo = fichero.slice(fichero.indexOf('/src/') + 1);
      salida.push(`${relativo}:${encontrado[1]}`);
    }
  }
  return salida.sort();
};

describe('los parámetros de consulta obligatorios', () => {
  it('se validan con un tubo o con un DTO', () => {
    expect(hallazgos()).toEqual([...SIN_VALIDAR.keys()].sort());
  });

  it('la prueba mira donde cree que mira', () => {
    // Si un día no encuentra controladores, el cero de arriba sería del
    // instrumento y no del código: eso ya pasó aquí con otras comprobaciones.
    expect(controladores(join(__dirname, '..')).length).toBeGreaterThan(40);
  });

  it('reconoce una firma sin validar, para no dar un cero de adorno', () => {
    const ejemplo = `
      @Get('lookup')
      async findByClerkId(
        @Query('clerkId') clerkId: string,
      ): Promise<UserResponseDto | null> {}
    `;
    expect([...ejemplo.matchAll(OBLIGATORIO_Y_SIN_TUBO)].length).toBe(1);
  });

  it('no se queja de lo que sí está resuelto', () => {
    const correctos = [
      "@Query('all') all?: string,", // opcional: el tipo ya obliga
      '@Query() query: ClerkLookupQueryDto,', // recogido en un DTO
      "@Query('id', ParseUUIDPipe) id: string,", // con tubo
      "@Query('page', ParseIntPipe) page: number,",
    ];
    for (const linea of correctos) {
      expect([...linea.matchAll(OBLIGATORIO_Y_SIN_TUBO)].length).toBe(0);
    }
  });
});
