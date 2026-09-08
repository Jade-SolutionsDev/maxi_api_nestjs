import {
  registerDecorator,
  type ValidationOptions,
  ValidatorConstraint,
  type ValidatorConstraintInterface,
} from 'class-validator';
import { CUBAN_ID_MESSAGE, isCubanIdCard } from '../utils/cuban-id';

@ValidatorConstraint({ name: 'isCubanIdCard', async: false })
class CubanIdCardConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    return isCubanIdCard(value);
  }

  defaultMessage(): string {
    return CUBAN_ID_MESSAGE;
  }
}

/** Valida un carnet de identidad cubano. Ver `isCubanIdCard` para el criterio. */
export const IsCubanIdCard =
  (options?: ValidationOptions) =>
  (object: object, propertyName: string): void => {
    registerDecorator({
      target: object.constructor,
      propertyName,
      options,
      constraints: [],
      validator: CubanIdCardConstraint,
    });
  };
