/**
 * La hora que ve el negocio.
 *
 * El proceso corre en UTC a propósito (`main.ts`): las columnas son
 * `timestamp without time zone` y la base guarda UTC, así que cualquier otra
 * zona en el proceso desplazaba las fechas al leerlas.
 *
 * El efecto secundario es que todo lo que se formatee sin decir la zona sale
 * en UTC, y a un documento que lee una persona en Cárdenas eso le sobran
 * cuatro horas. No es solo la hora: un pedido de las 23:10 del día 23 sale
 * como del **24**, y entonces el mismo pedido tiene un día en la tabla del
 * panel —que lo pinta el navegador, en hora local— y otro en el comprobante.
 *
 * Aquí vive la zona del negocio, para que nadie tenga que acordarse de
 * pasarla en cada llamada.
 */
export const ZONA_CUBA = 'America/Havana';

/**
 * Día y hora, en 24 horas y con segundos: `23/09/2026, 15:10:23`.
 *
 * En 24 horas a propósito, y no porque `es-CU` prefiera «11:10 p. m.»: es el
 * formato que ya enseña la tabla de pedidos del panel, y ver el mismo pedido
 * con dos relojes distintos hace dudar de si son la misma hora. Los segundos
 * vienen de ahí mismo: sirven para casar un pedido con su fila cuando dos
 * entran en el mismo minuto.
 */
export const fechaHoraEnCuba = (
  valor: Date | string | null | undefined,
): string =>
  valor
    ? new Date(valor).toLocaleString('es-CU', {
        timeZone: ZONA_CUBA,
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      })
    : '—';

/**
 * Lo mismo sin segundos, para las tablas: `23/09/2026, 15:10`.
 *
 * La columna «CREADO» del reporte tiene 102 puntos de ancho y los segundos la
 * desbordan.
 */
export const fechaHoraCortaEnCuba = (
  valor: Date | string | null | undefined,
): string =>
  valor
    ? new Date(valor).toLocaleString('es-CU', {
        timeZone: ZONA_CUBA,
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      })
    : '—';

/** Solo el día: `23/09/2026`. */
export const fechaEnCuba = (valor: Date | string | null | undefined): string =>
  valor
    ? new Date(valor).toLocaleDateString('es-CU', {
        timeZone: ZONA_CUBA,
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
      })
    : '—';

/** El mes en palabras, para los títulos de los reportes. */
export const mesEnCuba = (valor: Date | string): string =>
  new Date(valor).toLocaleDateString('es', {
    timeZone: ZONA_CUBA,
    month: 'long',
  });
