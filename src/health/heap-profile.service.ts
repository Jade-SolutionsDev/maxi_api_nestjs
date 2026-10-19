import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Session } from 'node:inspector/promises';

/** Una función y lo que lleva asignado, en megabytes. */
export interface LineaDelPerfil {
  funcion: string;
  fichero: string;
  linea: number;
  mb: number;
}

export interface Perfil {
  /** Megabytes vivos que el muestreo atribuye a código nuestro y ajeno. */
  totalMb: number;
  /** Los mayores asignadores, de más a menos. */
  top: LineaDelPerfil[];
  /** Segundos que lleva corriendo el muestreo. */
  segundos: number;
}

/**
 * Qué código asignó la memoria que el proceso tiene viva.
 *
 * `MxH-0166` lleva tres hipótesis caídas porque no había forma de mirar
 * dentro del proceso: la instantánea del montón pide `docker exec`, y eso
 * son permisos que la sesión que investiga no tiene. El muestreo de
 * asignaciones de V8 sí se puede pedir desde dentro, pesa kilobytes en vez
 * de gigabytes, y en vez de un volcado devuelve **pilas de llamada con el
 * fichero y la línea**.
 *
 * **Lo que mide, comprobado y no supuesto.** Cuenta solo lo que **sigue
 * vivo** cuando se lee: en la prueba de abajo, 120 MB asignados y soltados
 * dan 0,0 MB atribuidos, y 50 MB retenidos dan 44,9. O sea que esto no mide
 * «quién asigna mucho» —que sería casi todo el mundo— sino **quién no
 * suelta**, que es exactamente la pregunta de una fuga.
 *
 * Lo que no da es el camino de referencias que mantiene vivo cada objeto;
 * para eso sigue haciendo falta la instantánea. Pero para señalar al
 * culpable, el muestreo basta y cabe en kilobytes.
 *
 * Apagado salvo que `HEAP_PROFILE_ENABLED` lo encienda: abre el inspector
 * dentro del proceso y eso no se deja puesto por si acaso.
 */
@Injectable()
export class HeapProfileService implements OnModuleInit {
  private readonly logger = new Logger('PerfilDelMonton');
  private sesion?: Session;
  private desde?: number;

  constructor(private readonly configService: ConfigService) {}

  /**
   * Donde está encendido, el muestreo arranca solo.
   *
   * Tenerlo que arrancar a mano parece inofensivo hasta que cuenta: cada
   * despliegue reinicia el proceso y se lo lleva por delante, y la medición
   * que importa es la de la madrugada, cuando no hay nadie para darse cuenta.
   * Tres veces se perdió en una sola noche. Si alguien encendió la variable
   * es porque quiere medir.
   */
  async onModuleInit(): Promise<void> {
    if (!this.habilitado) return;
    await this.arrancar();
  }

  get habilitado(): boolean {
    return this.configService.get<boolean>('heapProfileEnabled') ?? false;
  }

  get corriendo(): boolean {
    return this.sesion !== undefined;
  }

  /**
   * @param intervalo bytes entre muestras. Cuanto más pequeño, más detalle y
   * más coste; 65.536 es el valor que V8 usa por omisión.
   */
  async arrancar(intervalo = 65536): Promise<void> {
    if (this.sesion) return;

    const sesion = new Session();
    sesion.connect();
    await sesion.post('HeapProfiler.startSampling', {
      samplingInterval: intervalo,
    });
    this.sesion = sesion;
    this.desde = Date.now();
    this.logger.warn(
      `Muestreo de asignaciones arrancado (cada ${intervalo} bytes).`,
    );
  }

  /** Lo acumulado hasta ahora. El muestreo sigue corriendo. */
  async leer(cuantas = 25): Promise<Perfil> {
    if (!this.sesion) throw new Error('El muestreo no está arrancado.');

    const { profile } = await this.sesion.post(
      'HeapProfiler.getSamplingProfile',
    );

    const plano: LineaDelPerfil[] = [];
    let total = 0;
    const recorrer = (nodo: {
      selfSize: number;
      callFrame: { functionName: string; url: string; lineNumber: number };
      children: unknown[];
    }): void => {
      total += nodo.selfSize;
      if (nodo.selfSize > 0) {
        plano.push({
          funcion: nodo.callFrame.functionName || '(anónima)',
          // La ruta completa dentro del contenedor no dice nada; lo que
          // importa es el fichero del repositorio.
          fichero: nodo.callFrame.url.replace(/^.*\/(dist|src)\//, '$1/'),
          linea: nodo.callFrame.lineNumber,
          mb: Math.round((nodo.selfSize / 1048576) * 100) / 100,
        });
      }
      for (const hijo of nodo.children) {
        recorrer(hijo as Parameters<typeof recorrer>[0]);
      }
    };
    recorrer(profile.head);

    plano.sort((a, b) => b.mb - a.mb);

    return {
      totalMb: Math.round((total / 1048576) * 10) / 10,
      top: plano.slice(0, cuantas),
      segundos: Math.round((Date.now() - (this.desde ?? Date.now())) / 1000),
    };
  }

  async parar(): Promise<void> {
    if (!this.sesion) return;
    await this.sesion.post('HeapProfiler.stopSampling');
    this.sesion.disconnect();
    this.sesion = undefined;
    this.desde = undefined;
    this.logger.warn('Muestreo de asignaciones detenido.');
  }
}
