import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Dos migraciones no pueden compartir sello de tiempo.
 *
 * Pasó el 9-oct-2026: dos sesiones trabajando a la vez eligieron
 * `1790400000000` el mismo día, y nadie lo vio hasta que las dos habían
 * corrido en staging. Y volvió a pasar una hora después, entre dos propuestas
 * abiertas — porque un sello libre en `develop` puede estar cogido en una rama
 * que todavía no se ha fusionado.
 *
 * **Qué rompe un sello repetido.** TypeORM ordena por el sello del nombre de
 * fichero, así que con un empate el orden de ejecución es arbitrario. Hoy eso
 * fue inofensivo —tocaban tablas distintas—, pero `migration:revert` revierte
 * «la última» y con dos iguales cuál es «la última» no está definido.
 *
 * **Y por qué conviene cazarlo aquí y no luego.** Una vez ejecutada, la
 * migración queda registrada en la tabla `migrations` **por el nombre de su
 * clase**: renumerarla hace que TypeORM la vea como nueva y la vuelva a
 * ejecutar. O sea que la salida barata —renumerar— solo existe **antes de que
 * la migración llegue a producción**. Después, la respuesta correcta es la
 * contraria: dejarlas como están y vivir con el `revert` ambiguo, porque
 * reejecutar en producción no es gratis ni siendo idempotente.
 *
 * Se comprueba el sello del **nombre de fichero**, que es el que ordena la
 * ejecución, y además que concuerde con el de la clase: son dos sitios donde
 * puede divergir.
 *
 * **Esto detecta, no previene, y conviene no confundirlo.** Corre contra el
 * árbol de trabajo, así que el CI de cada rama ve su rama y nada más: dos
 * ramas abiertas que eligen el mismo sello pasan las dos en verde, y la
 * colisión no aparece hasta que una se fusiona y la otra rebasa. Eso es tarde,
 * pero mucho antes que descubrirlo en la base de datos — que es como se
 * encontró. Para elegir sello de verdad hay que mirar también las ramas de las
 * propuestas abiertas, no solo `develop`.
 */
describe('los sellos de las migraciones', () => {
  const carpeta = join(__dirname);
  const migraciones = readdirSync(carpeta)
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.spec.ts'))
    .map((f) => ({ fichero: f, sello: /^(\d+)-/.exec(f)?.[1] ?? null }));

  it('todas llevan sello en el nombre', () => {
    expect(migraciones.filter((m) => m.sello === null)).toEqual([]);
  });

  it('no se repite ninguno', () => {
    const porSello = new Map<string, string[]>();
    for (const m of migraciones) {
      if (!m.sello) continue;
      porSello.set(m.sello, [...(porSello.get(m.sello) ?? []), m.fichero]);
    }
    const repetidos = [...porSello.entries()].filter(
      ([, ficheros]) => ficheros.length > 1,
    );
    // El mensaje importa: quien lo vea en el CI tiene que saber qué hacer.
    expect(repetidos).toEqual([]);
  });

  it('el sello del fichero y el de la clase coinciden', () => {
    const descuadradas = migraciones
      .filter(({ fichero, sello }) => {
        if (!sello) return false;
        const fuente = readFileSync(join(carpeta, fichero), 'utf8');
        const clase = /export class \w+?(\d{10,})\s+implements/.exec(fuente);
        return clase?.[1] !== sello;
      })
      .map(({ fichero }) => fichero);

    expect(descuadradas).toEqual([]);
  });
});
