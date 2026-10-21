import { ForbiddenException } from '@nestjs/common';

/**
 * Quién puede hablar con la API desde un navegador, y qué se responde a quien
 * no puede.
 *
 * **Por qué existe este fichero** (MxH-0182). La comprobación vivía dentro de
 * `main.ts`, y rechazaba con un `Error` corriente. `AllExceptionsFilter` hace
 * con un `Error` sin estado lo único que puede hacer: lo trata como avería del
 * servidor y responde **500**, con su traza de diez líneas en el registro. Así
 * que una petición *no autorizada* se contaba como *fallo nuestro*.
 *
 * No era teoría: los **únicos cuatro 500 que produjo la API de producción en
 * los siete días hasta el 21-oct-2026** fueron esto, los tres primeros en el
 * mismo segundo y contra rutas que no existen —un escáner buscando un GraphQL
 * abierto—. Siendo el 100 % de los 500 de la semana, cualquier vigilancia que
 * cuente errores del servidor arrancaba con cuatro falsos positivos puestos
 * desde fuera por quien quisiera.
 *
 * **Sigue abortando la petición, y eso es a propósito.** La salida de manual
 * sería `callback(null, false)`: no se ponen las cabeceras de CORS y el
 * navegador bloquea la respuesta él. Pero entonces la petición **sí llega al
 * controlador** y se ejecuta, y hoy no llega. Cambiar eso de paso, dentro de
 * una tarjeta sobre el código de estado, sería ampliar en silencio lo que
 * puede hacer un origen que no está en la lista. Aquí solo se arregla la
 * mentira: 403 en vez de 500.
 *
 * **Una petición sin `Origin` pasa**, como antes: no viene de un navegador
 * —curl, un webhook, otro servicio— y CORS no tiene nada que decir de ella.
 * Quien protege esas rutas es la sesión, no esto.
 */
export const origenPermitido = (
  origin: string | undefined,
  permitidos: readonly string[],
): boolean => !origin || permitidos.includes(origin);

/**
 * El `Origin` lo escribe quien llama, así que no va crudo al registro: un salto
 * de línea ahí dentro le deja inventarse una línea de registro entera, y un
 * valor larguísimo llena el disco de quien lo lea. Se recortan los caracteres
 * de control y la longitud.
 */
export const origenParaElRegistro = (origin: string): string => {
  const limpio = origin.replace(/[^\x20-\x7e]/g, '·');
  return limpio.length > 120 ? `${limpio.slice(0, 120)}…` : limpio;
};

type CallbackDeCors = (err: Error | null, allow?: boolean) => void;

/**
 * El `origin` que espera `enableCors`. `avisar` recibe una línea por rechazo:
 * el filtro no registra nada por debajo de 500, y sin esto un frontend con el
 * dominio mal puesto fallaría sin dejar rastro en el servidor.
 */
export const comprobarOrigen =
  (permitidos: readonly string[], avisar: (mensaje: string) => void) =>
  (origin: string | undefined, callback: CallbackDeCors): void => {
    // El `!origin` va aquí y no solo dentro de `origenPermitido` para que
    // TypeScript sepa que abajo ya es una cadena.
    if (!origin || origenPermitido(origin, permitidos)) {
      callback(null, true);
      return;
    }

    avisar(`Origen rechazado por CORS: ${origenParaElRegistro(origin)}`);
    callback(
      new ForbiddenException('Ese origen no puede usar esta API'),
      false,
    );
  };
