import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { ParseUUIDPipe } from '@nestjs/common';
import { PATH_METADATA, ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import { RouteParamtypes } from '@nestjs/common/enums/route-paramtypes.enum';

/**
 * Todo parámetro de ruta que acabe comparándose con una columna `uuid` tiene
 * que validarse antes, con `ParseUUIDPipe`.
 *
 * **Qué pasa si no.** Postgres no compara una cadena cualquiera con una
 * columna `uuid`: revienta. Y revienta como error interno, así que la API
 * responde **500 a una petición que venía mal**. `GET /api/clients/create`
 * —MxH-0143— llevaba así quién sabe cuánto. Un 500 miente sobre de quién es
 * la culpa: quien lo vea en un registro se pondrá a buscar una avería del
 * servidor que no existe, y mientras tanto el cliente no se entera de que lo
 * que mandó no era un identificador. Con el tubo puesto, lo mismo responde
 * **400**, que es la verdad.
 *
 * **Por qué una guardia y no solo el arreglo.** El tubo ya estaba en 75 de los
 * 113 parámetros cuando se escribió esto: nadie decidió dejar fuera los otros
 * 38, se fueron quedando. La ruta de direcciones del cliente lo recibió en
 * MxH-0178 y sus cuatro hermanas del mismo controlador no, porque el arreglo
 * se hace ruta por ruta y la siguiente ruta nueva vuelve a empezar de cero.
 * Esto lo convierte en algo que el CI caza en la propuesta.
 *
 * **Lee los metadatos, no el texto.** Nest guarda en la clase del controlador
 * los tubos de cada parámetro; es exactamente lo que ejecutará en producción.
 * Mirar el código fuente con una expresión regular habría medido el formato
 * —un salto de línea en medio y deja de ver el tubo—, no el comportamiento.
 *
 * **Las excepciones van con su razón escrita.** Un parámetro de ruta no es
 * siempre un uuid, y validarlo como tal rompería la ruta. Para añadir una,
 * hace falta decir por qué: si el que sobra es el tubo, el sitio donde se
 * discute es aquí.
 */

/** `Clase.método(parámetro)` → por qué ese no es un uuid. */
const NO_SON_UUID = new Map<string, string>([
  [
    'ClientsController.revokeInvitation(id)',
    'Identificador de invitación de Clerk (`inv_…`), que va directo a su API ' +
      'sin pasar por ninguna tabla nuestra.',
  ],
  [
    'PublicCmsController.page(slug)',
    'Es un slug, la dirección legible de la página publicada.',
  ],
  [
    'PaymentsWebhookController.handle(provider)',
    'Es el nombre de la pasarela (`tropipay`, `mibilletera`), no una fila.',
  ],
  [
    'OrderTrackingController.track(trackingId)',
    'Son 64 caracteres hexadecimales, no un uuid, y el servicio ya los ' +
      'valida: un identificador mal formado y uno inexistente responden 404 ' +
      'igual, a propósito, para no decirle a quien prueba enlaces cuáles ' +
      'existen.',
  ],
]);

type Constructor = new (...args: never[]) => unknown;

interface ArgumentoDeRuta {
  index: number;
  data?: unknown;
  pipes?: unknown[];
}

/** `RouteParamtypes.PARAM`, suelto, para compararlo con el número de la clave. */
const ES_PARAMETRO_DE_RUTA: number = RouteParamtypes.PARAM;

const controladores = (): Constructor[] => {
  const buscar = (dir: string): string[] =>
    readdirSync(dir).flatMap((nombre) => {
      const ruta = join(dir, nombre);
      if (statSync(ruta).isDirectory()) return buscar(ruta);
      return nombre.endsWith('.controller.ts') ? [ruta] : [];
    });

  const clases: Constructor[] = [];
  for (const fichero of buscar(join(__dirname, '..'))) {
    // `import()` aquí no vale: ts-jest lo deja como import de ESM y este
    // Jest corre en CommonJS, así que revienta pidiendo
    // `--experimental-vm-modules`. Cargar el módulo es justo lo que hace esta
    // prueba, que mide los metadatos que deja el decorador al evaluarse.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const modulo = require(fichero) as Record<string, unknown>;
    for (const exportado of Object.values(modulo)) {
      if (
        typeof exportado === 'function' &&
        Reflect.hasMetadata(PATH_METADATA, exportado)
      ) {
        clases.push(exportado as Constructor);
      }
    }
  }
  return clases;
};

/** Cada parámetro de ruta de la aplicación, con su clave y sus tubos. */
const parametrosDeRuta = (): { clave: string; validado: boolean }[] => {
  const salida: { clave: string; validado: boolean }[] = [];
  for (const clase of controladores()) {
    const metodos = Object.getOwnPropertyNames(clase.prototype).filter(
      (nombre) => nombre !== 'constructor',
    );
    for (const metodo of metodos) {
      const argumentos = Reflect.getMetadata(
        ROUTE_ARGS_METADATA,
        clase,
        metodo,
      ) as Record<string, ArgumentoDeRuta> | undefined;
      if (!argumentos) continue;

      for (const [llave, argumento] of Object.entries(argumentos)) {
        const tipo = Number(llave.split(':')[0]);
        if (tipo !== ES_PARAMETRO_DE_RUTA) continue;

        const nombre =
          typeof argumento.data === 'string' ? argumento.data : '(todos)';
        const tubos = argumento.pipes ?? [];
        salida.push({
          clave: `${clase.name}.${metodo}(${nombre})`,
          validado: tubos.some(
            (tubo) => tubo === ParseUUIDPipe || tubo instanceof ParseUUIDPipe,
          ),
        });
      }
    }
  }
  return salida;
};

describe('los identificadores que llegan por la ruta', () => {
  const todos = parametrosDeRuta();

  it('hay bastantes, o la prueba no está midiendo nada', () => {
    // Si un día esto baja de golpe, lo que se rompió es la prueba —importar
    // los controladores— y no el código.
    expect(todos.length).toBeGreaterThan(100);
  });

  it('se validan con ParseUUIDPipe, salvo los que no son uuid', () => {
    const sinValidar = todos
      .filter((p) => !p.validado)
      .map((p) => p.clave)
      .sort();
    const esperados = [...NO_SON_UUID.keys()].sort();
    expect(sinValidar).toEqual(esperados);
  });

  it('ninguna excepción sobra', () => {
    const claves = new Set(todos.map((p) => p.clave));
    const fantasmas = [...NO_SON_UUID.keys()].filter((c) => !claves.has(c));
    expect(fantasmas).toEqual([]);
  });
});
