/**
 * Copy only defined values from `source` onto `target`.
 *
 * Validated PATCH DTOs (ES2023 + useDefineForClassFields) materialize every
 * optional field as an own property set to `undefined`, so a plain
 * `Object.assign(entity, dto)` clobbers untouched columns with `undefined`.
 * Assigning only defined keys keeps the loaded entity intact for partial updates.
 */
export function assignDefined<T>(target: T, source: Partial<T>): T {
  for (const [key, value] of Object.entries(source)) {
    if (value !== undefined) {
      (target as Record<string, unknown>)[key] = value;
    }
  }
  return target;
}
