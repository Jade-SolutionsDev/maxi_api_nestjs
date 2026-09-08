/**
 * Carnet de identidad cubano: 11 dígitos, `AAMMDD` + 5.
 *
 * No hay dígito de control publicado y fiable, así que esto valida lo que se
 * puede validar de verdad: la longitud y que la fecha que lleva dentro exista.
 * Rechaza un `990230` —30 de febrero— y no promete más que eso.
 *
 * El dígito 7 marca el siglo: 0-5 → 1900, 6-8 → 2000, 9 → 1800. Es lo que
 * permite saber si `04` es 1904 o 2004 antes de comprobar el día.
 */
const SIGLOS: Record<string, number> = {
  '0': 1900, '1': 1900, '2': 1900, '3': 1900, '4': 1900, '5': 1900,
  '6': 2000, '7': 2000, '8': 2000,
  '9': 1800,
};

export const isCubanIdCard = (value: unknown): boolean => {
  if (typeof value !== 'string') return false;
  const ci = value.trim();
  if (!/^\d{11}$/.test(ci)) return false;

  const siglo = SIGLOS[ci[6]];
  if (siglo === undefined) return false;

  const anio = siglo + Number(ci.slice(0, 2));
  const mes = Number(ci.slice(2, 4));
  const dia = Number(ci.slice(4, 6));
  if (mes < 1 || mes > 12 || dia < 1) return false;

  // `Date.UTC` normaliza un 31 de abril a 1 de mayo; comparar los tres
  // componentes es lo que convierte eso en un rechazo.
  const fecha = new Date(Date.UTC(anio, mes - 1, dia));
  return (
    fecha.getUTCFullYear() === anio &&
    fecha.getUTCMonth() === mes - 1 &&
    fecha.getUTCDate() === dia
  );
};

/** Mensaje único, para que la tienda y la API digan lo mismo. */
export const CUBAN_ID_MESSAGE =
  'El carnet de identidad debe tener 11 dígitos y una fecha de nacimiento válida';
