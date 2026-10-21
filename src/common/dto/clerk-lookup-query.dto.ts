import { IsNotEmpty, IsString, Length } from 'class-validator';

/**
 * El `clerkId` por el que `GET /clients/lookup` y `GET /users/lookup` buscan
 * una cuenta.
 *
 * **Por qué hace falta un DTO para un solo campo** (MxH-0181). Antes el
 * parámetro se recogía con `@Query('clerkId') clerkId: string`, y cuando no
 * venía llegaba `undefined` hasta el `where` de TypeORM, que se niega a
 * construirlo y lanza. El resultado era un **500 a una petición que venía
 * mal**, la misma familia que MxH-0143 pero por la vía del parámetro de
 * consulta en vez del de la ruta. El tipo declarado decía `string`, así que
 * TypeScript creía que nunca faltaba y nadie lo comprobaba.
 *
 * Con esto el `ValidationPipe` global responde **400** y nombra el campo, sin
 * que el controlador tenga que comprobar nada.
 *
 * **Y por qué no vale la salida que sugiere el propio error de TypeORM.** El
 * mensaje propone `invalidWhereValuesBehavior.undefined: 'ignore'`, que
 * convertiría la consulta en una sin condiciones: devolvería la primera fila
 * de la tabla. En `clients` eso es entregar los datos de un cliente cualquiera
 * a quien preguntó por otro — un 500 ruidoso cambiado por una respuesta
 * silenciosamente equivocada.
 *
 * **El vacío también es 400**, no una búsqueda que no encuentra nada. Una
 * cadena vacía no es un identificador, y responder `null` invita a quien llama
 * a leer «no mandé nada» como «no existe»: justo la confusión que esta tarjeta
 * viene a quitar.
 */
export class ClerkLookupQueryDto {
  @IsString()
  @IsNotEmpty()
  @Length(1, 255)
  clerkId: string;
}
