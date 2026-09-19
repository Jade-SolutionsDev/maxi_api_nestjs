/**
 * Días hábiles del negocio, para calcular hasta cuándo hay de plazo.
 *
 * Reglas fijadas por Jade el 19-sep-2026: **se trabaja de lunes a sábado**, y
 * no cuentan ni los domingos ni los feriados nacionales cubanos.
 *
 * Todo se cuenta en la hora de Cuba, no en UTC: un pedido pagado a las 21:00
 * del sábado en La Habana son las 01:00 del domingo en UTC, y contar en UTC
 * regalaría un día.
 */

const ZONA = 'America/Havana';

/** Feriados nacionales de Cuba, en formato `MM-DD`. Viernes Santo va aparte: se mueve. */
const FERIADOS_FIJOS = [
  '01-01', // Triunfo de la Revolución
  '01-02', // Día de la Victoria
  '05-01', // Día de los Trabajadores
  '07-25', // Conmemoración del asalto a Moncada
  '07-26', // Día de la Rebeldía Nacional
  '07-27', // Conmemoración del asalto a Moncada
  '10-10', // Inicio de las Guerras de Independencia
  '12-25', // Navidad
  '12-31', // Fin de año
];

/**
 * Domingo de Pascua por el algoritmo de Meeus/Jones/Butcher (gregoriano).
 * Hace falta porque el Viernes Santo es feriado en Cuba y cae dos días antes.
 */
const domingoDePascua = (anio: number): { mes: number; dia: number } => {
  const a = anio % 19;
  const b = Math.floor(anio / 100);
  const c = anio % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31);
  const dia = ((h + l - 7 * m + 114) % 31) + 1;
  return { mes, dia };
};

const dosDigitos = (n: number): string => String(n).padStart(2, '0');

/** Los feriados de un año, como fechas `YYYY-MM-DD`. */
export const feriadosCubanos = (anio: number): Set<string> => {
  const dias = new Set(FERIADOS_FIJOS.map((md) => `${anio}-${md}`));

  const pascua = domingoDePascua(anio);
  const viernesSanto = new Date(Date.UTC(anio, pascua.mes - 1, pascua.dia - 2));
  dias.add(
    `${viernesSanto.getUTCFullYear()}-${dosDigitos(
      viernesSanto.getUTCMonth() + 1,
    )}-${dosDigitos(viernesSanto.getUTCDate())}`,
  );

  return dias;
};

/** La fecha civil en Cuba de un instante dado, como `YYYY-MM-DD`. */
export const fechaEnCuba = (instante: Date): string =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: ZONA,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instante);

/** El desplazamiento horario de Cuba en ese instante, en minutos (−300 o −240). */
const desfaseDeCuba = (instante: Date): number => {
  const partes = new Intl.DateTimeFormat('en-US', {
    timeZone: ZONA,
    timeZoneName: 'longOffset',
  })
    .formatToParts(instante)
    .find((parte) => parte.type === 'timeZoneName')?.value;
  const encontrado = /GMT([+-])(\d{2}):(\d{2})/.exec(partes ?? '');
  if (!encontrado) {
    return -300;
  }
  const signo = encontrado[1] === '-' ? -1 : 1;
  return signo * (Number(encontrado[2]) * 60 + Number(encontrado[3]));
};

const esHabil = (fecha: string): boolean => {
  const [anio, mes, dia] = fecha.split('-').map(Number);
  const diaSemana = new Date(Date.UTC(anio, mes - 1, dia)).getUTCDay();
  if (diaSemana === 0) {
    return false; // domingo
  }
  return !feriadosCubanos(anio).has(fecha);
};

const siguienteDia = (fecha: string): string => {
  const [anio, mes, dia] = fecha.split('-').map(Number);
  const proximo = new Date(Date.UTC(anio, mes - 1, dia + 1));
  return `${proximo.getUTCFullYear()}-${dosDigitos(
    proximo.getUTCMonth() + 1,
  )}-${dosDigitos(proximo.getUTCDate())}`;
};

/**
 * El final del día hábil número `dias` contado desde `desde`.
 *
 * El día en que se paga no cuenta: con plazo 1, un pedido pagado el lunes
 * vence al final del martes. Y el resultado es el final del día en Cuba, no su
 * comienzo: un pedido entregado esa misma tarde llegó a tiempo.
 *
 * Devuelve `null` si no hay plazo que contar.
 */
export const finDelPlazo = (desde: Date, dias: number | null): Date | null => {
  if (!dias || dias <= 0) {
    return null;
  }

  let fecha = fechaEnCuba(desde);
  let contados = 0;
  // Tope de seguridad: 400 vueltas cubren más de un año de feriados seguidos.
  for (let vuelta = 0; vuelta < 400 && contados < dias; vuelta += 1) {
    fecha = siguienteDia(fecha);
    if (esHabil(fecha)) {
      contados += 1;
    }
  }

  const [anio, mes, dia] = fecha.split('-').map(Number);
  // Medianoche de Cuba de ese día, menos un segundo: el último instante útil.
  const medianocheSiguienteUtc = Date.UTC(anio, mes - 1, dia + 1);
  const aproximado = new Date(medianocheSiguienteUtc);
  const desfase = desfaseDeCuba(aproximado);
  return new Date(medianocheSiguienteUtc - desfase * 60 * 1000 - 1000);
};
