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

/** Lower-case a `?sortOrder=ASC` value so `@IsIn(['asc','desc'])` is case-tolerant. */
export const toSortOrder = ({ value }: TransformFnParams): unknown =>
  typeof value === 'string' ? value.toLowerCase() : value;
