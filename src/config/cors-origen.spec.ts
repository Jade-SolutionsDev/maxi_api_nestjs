import { ForbiddenException, HttpStatus } from '@nestjs/common';
import {
  comprobarOrigen,
  origenParaElRegistro,
  origenPermitido,
} from './cors-origen';

/**
 * MxH-0182. Lo que se fija aquí no es «rechaza», que ya rechazaba: es **con
 * qué** rechaza. Un `Error` corriente sale del filtro como 500, y así los
 * cuatro únicos 500 de producción de una semana fueron peticiones no
 * autorizadas contadas como averías nuestras.
 */
describe('el origen que puede usar la API', () => {
  const permitidos = ['https://maxihabana.com', 'https://admin.maxihabana.com'];

  describe('quién pasa', () => {
    it('un origen de la lista', () => {
      expect(origenPermitido('https://maxihabana.com', permitidos)).toBe(true);
    });

    it('sin Origin pasa: no viene de un navegador', () => {
      expect(origenPermitido(undefined, permitidos)).toBe(true);
    });

    it('uno que no está en la lista, no', () => {
      expect(origenPermitido('https://evil.example', permitidos)).toBe(false);
    });

    it('el dominio de la propia API tampoco, que es el caso real', () => {
      // Es el origen que mandó el escáner del 17-oct y provocó los 500.
      expect(origenPermitido('https://api.maxihabana.com', permitidos)).toBe(
        false,
      );
    });

    it('con la lista vacía solo pasa quien no manda Origin', () => {
      expect(origenPermitido(undefined, [])).toBe(true);
      expect(origenPermitido('https://maxihabana.com', [])).toBe(false);
    });

    it('no vale parecerse: ni subdominio, ni puerto, ni barra de más', () => {
      for (const parecido of [
        'https://maxihabana.com.evil.example',
        'https://sub.maxihabana.com',
        'https://maxihabana.com:8443',
        'https://maxihabana.com/',
        'http://maxihabana.com',
      ]) {
        expect(origenPermitido(parecido, permitidos)).toBe(false);
      }
    });
  });

  describe('qué se responde a quien no pasa', () => {
    const rechazo = (origin: string | undefined) => {
      const avisos: string[] = [];
      let error: Error | null = null;
      let permitido: boolean | undefined;
      comprobarOrigen(permitidos, (m) => avisos.push(m))(origin, (e, ok) => {
        error = e;
        permitido = ok;
      });
      return { avisos, error: error as Error | null, permitido };
    };

    it('un 403, no un 500: es el arreglo de esta tarjeta', () => {
      const { error } = rechazo('https://evil.example');
      expect(error).toBeInstanceOf(ForbiddenException);
      expect((error as ForbiddenException).getStatus()).toBe(
        HttpStatus.FORBIDDEN,
      );
    });

    it('nunca un Error pelado, que es lo que el filtro lee como 500', () => {
      const { error } = rechazo('https://evil.example');
      // Un `Error` sin `status` no le deja al filtro otra salida que el 500.
      expect((error as unknown as { getStatus?: unknown }).getStatus).toEqual(
        expect.any(Function),
      );
    });

    it('sigue abortando la petición, como antes', () => {
      // `allow: false` con error: no se ponen cabeceras y no se sirve la ruta.
      expect(rechazo('https://evil.example').permitido).toBe(false);
    });

    it('deja una línea en el registro, para poder diagnosticarlo', () => {
      const { avisos } = rechazo('https://evil.example');
      expect(avisos).toEqual([
        'Origen rechazado por CORS: https://evil.example',
      ]);
    });

    it('a quien pasa no se le avisa ni se le pone error', () => {
      for (const bueno of [undefined, 'https://maxihabana.com']) {
        const { avisos, error, permitido } = rechazo(bueno);
        expect(avisos).toEqual([]);
        expect(error).toBeNull();
        expect(permitido).toBe(true);
      }
    });
  });

  describe('el Origin no llega crudo al registro', () => {
    it('un salto de línea no le deja inventarse una línea entera', () => {
      const inyectado =
        'https://x.example\n[Nest] ERROR [Pagos] todo se perdió';
      expect(origenParaElRegistro(inyectado)).not.toContain('\n');
      expect(origenParaElRegistro(inyectado)).toContain('·');
    });

    it('un valor larguísimo se recorta', () => {
      const largo = `https://${'a'.repeat(500)}.example`;
      const salida = origenParaElRegistro(largo);
      expect(salida.length).toBeLessThanOrEqual(121);
      expect(salida.endsWith('…')).toBe(true);
    });

    it('uno normal se deja tal cual', () => {
      expect(origenParaElRegistro('https://maxihabana.com')).toBe(
        'https://maxihabana.com',
      );
    });
  });
});
