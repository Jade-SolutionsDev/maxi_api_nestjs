import { ArgumentsHost, ForbiddenException, Logger } from '@nestjs/common';
import { Request, Response } from 'express';
import { AllExceptionsFilter } from './all-exceptions.filter';

/**
 * Qué estado y qué registro sale de cada clase de fallo.
 *
 * Escrita con MxH-0182, que es el caso de abajo: la comprobación de CORS
 * rechazaba con un `Error` corriente, y un `Error` sin estado no le deja a este
 * filtro otra salida que el 500 —con su traza—. Así que una petición no
 * autorizada se contaba como avería nuestra, y fueron **el 100 % de los 500 de
 * producción** de la semana del 14 al 21-oct-2026.
 *
 * Lo que se fija aquí es la cadena entera: que un `ForbiddenException` sale
 * como 403 **y sin traza**, y que un `Error` pelado sigue saliendo como 500
 * **con** traza, que para eso está.
 */
describe('AllExceptionsFilter', () => {
  const contexto = () => {
    const json = jest.fn();
    const status = jest.fn().mockReturnValue({ json });
    const host = {
      switchToHttp: () => ({
        getResponse: () => ({ status }) as unknown as Response,
        getRequest: () =>
          ({ method: 'POST', url: '/api/graphql' }) as unknown as Request,
      }),
    } as unknown as ArgumentsHost;
    return { host, status, json };
  };

  let error: jest.SpyInstance;

  beforeEach(() => {
    error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    error.mockRestore();
  });

  it('un origen rechazado por CORS sale 403 y no mancha el registro', () => {
    const { host, status, json } = contexto();

    new AllExceptionsFilter().catch(
      new ForbiddenException('Ese origen no puede usar esta API'),
      host,
    );

    expect(status).toHaveBeenCalledWith(403);
    expect(json).toHaveBeenCalledWith({
      error: {
        code: 'ForbiddenException',
        message: 'Ese origen no puede usar esta API',
      },
    });
    expect(error).not.toHaveBeenCalled();
  });

  it('un Error pelado sigue siendo 500, y con su traza', () => {
    const { host, status } = contexto();

    new AllExceptionsFilter().catch(
      new Error('se cayó el almacenamiento'),
      host,
    );

    expect(status).toHaveBeenCalledWith(500);
    expect(error).toHaveBeenCalledWith(
      'POST /api/graphql -> 500',
      expect.stringContaining('se cayó el almacenamiento'),
    );
  });

  it('un fallo con estado propio lo conserva: un cuerpo enorme es 413', () => {
    const { host, status } = contexto();
    const grande = Object.assign(new Error('request entity too large'), {
      status: 413,
    });

    new AllExceptionsFilter().catch(grande, host);

    expect(status).toHaveBeenCalledWith(413);
    expect(error).not.toHaveBeenCalled();
  });
});
