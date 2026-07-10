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
