import { ConflictException } from '@nestjs/common';

/**
 * Se intentó invitar a un correo cuyo usuario está borrado (baja lógica).
 *
 * Borrar un usuario no toca su cuenta de Clerk, así que Clerk rechazaría la
 * invitación de todas formas («ese correo ya tiene cuenta»). Hasta el
 * 18-oct-2026 la petición llegaba hasta Clerk, fallaba allí y el panel solo
 * podía enseñar un texto (MxH-0122, MxH-0123). Ahora se detecta antes, sin
 * llamar a Clerk, y la respuesta lleva el id del usuario borrado en
 * `details[0].userId` para que el panel ofrezca restaurarlo en vez de
 * mandar a buscarlo.
 *
 * El nombre de la clase es el `code` del sobre de error
 * (`AllExceptionsFilter` usa `exception.name`), así que el panel lo
 * distingue de cualquier otro 409 sin leer el mensaje.
 */
export class UsuarioBorradoException extends ConflictException {
  constructor(email: string, userId: string) {
    super({
      message:
        `${email} pertenece a un usuario borrado. Su cuenta de Clerk sigue existiendo, ` +
        'así que no admite una invitación nueva: restáuralo y entrará con lo que ya tenía.',
      details: [{ field: 'email', message: 'usuario borrado', userId }],
    });
  }
}
