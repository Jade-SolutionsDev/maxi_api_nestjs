import { IsEnum, IsNumber, Max, Min } from 'class-validator';
import { LocationSource } from '../entities/client-address.entity';

/**
 * El punto en el mapa de una dirección, como objeto y no como tres campos
 * sueltos. La forma es la que hace cumplir las reglas sin código extra:
 *
 *   - **El par incompleto es imposible.** Las dos coordenadas son obligatorias
 *     *dentro* del objeto, así que «o van las dos o ninguna» lo resuelve la
 *     validación y no una comprobación cruzada entre campos.
 *   - **Nunca hay punto sin procedencia.** `source` también es obligatorio
 *     aquí, de modo que no puede llegar una coordenada sin decir de dónde
 *     salió.
 *   - **Se puede borrar.** Mandar `location: null` quita el punto; omitirlo
 *     lo deja como estaba. Con tres campos sueltos las dos cosas se parecen
 *     demasiado.
 *
 * El rango se comprueba con `Min`/`Max` y no con `IsLatitude`/`IsLongitude`:
 * esos dos validan por formato de par «lat,long» y el mensaje de error no
 * dice cuál es el límite. Aquí el aviso que le llega a quien integra es
 * literalmente «latitude must not be less than -90».
 */
export class AddressLocationDto {
  /** Grados, entre -90 y 90. Más de seis decimales se redondean al guardar. */
  @IsNumber()
  @Min(-90)
  @Max(90)
  latitude: number;

  /** Grados, entre -180 y 180. */
  @IsNumber()
  @Min(-180)
  @Max(180)
  longitude: number;

  /** `device` si la dio el navegador, `manual` si se marcó en el mapa. */
  @IsEnum(LocationSource)
  source: LocationSource;
}
