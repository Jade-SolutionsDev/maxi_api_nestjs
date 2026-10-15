import { UnauthorizedException } from '@nestjs/common';

/**
 * Por qué una cuenta de Clerk válida no puede entrar al panel. Son los dos
 * casos que la persona puede resolver hablando con alguien, y por eso tienen
 * código propio: el panel los distingue de un token caducado o inválido, que
 * se arregla volviendo a entrar, y le dice a cada quien qué le pasa en vez de
 * devolverlo a la pantalla de acceso sin una palabra (MxH-0158).
 */
export type MotivoSinAcceso = 'NOT_REGISTERED' | 'ACCOUNT_INACTIVE';

export class BackofficeAccessException extends UnauthorizedException {
  constructor(
    readonly motivo: MotivoSinAcceso,
    mensaje: string,
  ) {
    super(mensaje);
    // El filtro de errores publica `exception.name` como `error.code`, así que
    // esto es lo que el panel lee para saber qué enseñar.
    this.name = motivo;
  }
}
