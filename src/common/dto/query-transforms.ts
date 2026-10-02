import { TransformFnParams } from 'class-transformer';

/** Coerce `?flag=true|false` query strings into real booleans (or leave absent). */
export const toOptionalBoolean = ({ value }: TransformFnParams): unknown => {
  if (value === undefined || value === '') {
    return undefined;
  }
  if (value === 'true' || value === true) {
    return true;
  }
  if (value === 'false' || value === false) {
    return false;
  }
  return value;
};

/** Coerce `?n=123` query strings into numbers (absent/empty/invalid → undefined). */
export const toOptionalNumber = ({ value }: TransformFnParams): unknown => {
  if (value === undefined || value === '' || value === null) {
    return undefined;
  }
  const n = Number(value);
  return Number.isNaN(n) ? undefined : n;
};

/** Split `?ids=a,b` into a trimmed list, keeping order (absent/empty → undefined). */
export const toOptionalList = ({ value }: TransformFnParams): unknown => {
  const raw: unknown[] = Array.isArray(value) ? value : [value];
  const items = raw
    .flatMap((item) => (typeof item === 'string' ? item.split(',') : [item]))
    .map((item) => (typeof item === 'string' ? item.trim() : item))
    .filter((item) => item !== undefined && item !== null && item !== '');
  return items.length ? items : undefined;
};

/** Lower-case a `?sortOrder=ASC` value so `@IsIn(['asc','desc'])` is case-tolerant. */
export const toSortOrder = ({ value }: TransformFnParams): unknown =>
  typeof value === 'string' ? value.toLowerCase() : value;

/**
 * Una cadena vacía es «sin filtro», no un valor a validar.
 *
 * `@IsOptional()` solo perdona lo ausente: un formulario que manda `from: ''`
 * —porque el campo se dejó en blanco— hacía que `@IsDateString` rechazara el
 * cuerpo entero y la petición muriera con un 400 que nadie veía. Le pasó al
 * envío del reporte por correo el 25-sep-2026.
 */
export const vacioEsNada = ({ value }: TransformFnParams): unknown =>
  typeof value === 'string' && value.trim() === '' ? undefined : value;
