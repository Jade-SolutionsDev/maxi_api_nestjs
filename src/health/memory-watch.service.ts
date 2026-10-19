import {
  Injectable,
  Logger,
  OnApplicationShutdown,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { getHeapStatistics } from 'node:v8';

/** Lo que se mide en cada muestra, ya en megabytes. */
export interface MuestraDeMemoria {
  /** Lo que el montón de JavaScript tiene ocupado ahora. */
  heapUsadoMb: number;
  /** Lo que el montón tiene reservado al sistema. */
  heapTotalMb: number;
  /** El techo del proceso. Al llegar aquí, Node muere con `FATAL ERROR`. */
  heapLimiteMb: number;
  /** Qué parte del techo se lleva usado, de 0 a 100. */
  usoPct: number;
  /** Memoria residente: el montón más todo lo demás del proceso. */
  rssMb: number;
  /** Búferes y objetos de C++ enganchados a objetos de JavaScript. */
  externaMb: number;
  /** Horas que lleva el proceso en pie, con un decimal. */
  horasEnPie: number;
}

const MB = 1024 * 1024;
const mb = (bytes: number): number => Math.round(bytes / MB);

/**
 * Mide el montón cada minuto y lo deja escrito.
 *
 * Existe por `MxH-0166`: la API se queda sin memoria y muere —producción
 * incluida, el 8-oct-2026 tras 69 horas en pie— y la única forma de saberlo
 * era encontrar el `FATAL ERROR` en los registros **después**, o ver fallar
 * la corrida nocturna. No había ninguna medida de la memoria mientras el
 * proceso estaba vivo, así que tampoco había manera de responder la pregunta
 * que decide el diagnóstico: si el montón sube monótono entre corridas o
 * solo durante ellas.
 *
 * Esto no arregla la fuga. La hace visible: cada muestra es una línea en
 * Loki, y con eso Grafana dibuja la curva y el aviso llega antes de la
 * muerte, no después.
 */
@Injectable()
export class MemoryWatchService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger('Memoria');
  private temporizador?: NodeJS.Timeout;

  constructor(private readonly configService: ConfigService) {}

  onModuleInit(): void {
    const cada = this.configService.get<number>('memoryWatchIntervalMs') ?? 0;
    if (cada <= 0) return;

    // `unref` para que este temporizador no sea motivo de que el proceso siga
    // vivo: cuando no quede nada más que hacer, que se apague igual.
    this.temporizador = setInterval(() => this.medir(), cada);
    this.temporizador.unref();

    // Una muestra al arrancar: así la curva empieza en el suelo conocido y se
    // puede comparar un despliegue con el anterior.
    this.medir();
  }

  onApplicationShutdown(): void {
    if (this.temporizador) clearInterval(this.temporizador);
  }

  /** La muestra de ahora mismo. Pública para poder consultarla a demanda. */
  medir(): MuestraDeMemoria {
    const uso = process.memoryUsage();
    const limite = getHeapStatistics().heap_size_limit;
    const muestra: MuestraDeMemoria = {
      heapUsadoMb: mb(uso.heapUsed),
      heapTotalMb: mb(uso.heapTotal),
      heapLimiteMb: mb(limite),
      usoPct: Math.round((uso.heapUsed / limite) * 100),
      rssMb: mb(uso.rss),
      externaMb: mb(uso.external),
      horasEnPie: Math.round((process.uptime() / 3600) * 10) / 10,
    };

    // Pares `clave=valor` a propósito: así la línea se lee de un vistazo en el
    // registro y Grafana puede sacar la serie sin que nadie escriba una
    // expresión regular a medida.
    const linea =
      `heap_usado_mb=${muestra.heapUsadoMb} heap_total_mb=${muestra.heapTotalMb} ` +
      `heap_limite_mb=${muestra.heapLimiteMb} uso_pct=${muestra.usoPct} ` +
      `rss_mb=${muestra.rssMb} externa_mb=${muestra.externaMb} ` +
      `horas_en_pie=${muestra.horasEnPie}`;

    if (muestra.usoPct >= 90) {
      // A este ritmo quedan minutos, no horas: lo que venga después de este
      // aviso es el `FATAL ERROR` y el reinicio, con las peticiones en vuelo
      // perdidas.
      this.logger.error(`${linea} estado=critico`);
    } else if (muestra.usoPct >= 75) {
      this.logger.warn(`${linea} estado=alto`);
    } else {
      this.logger.log(linea);
    }

    return muestra;
  }
}
