import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  type PaymentLink,
  type PaymentLinkPayload,
  ServerSideUtils,
  Tropipay,
} from '@yosle/tropipayjs';
import { PaymentsConfig, TropipayConfig } from '../../../config/configuration';

/** Lo que una petición saliente del SDK nos deja ver y tocar. */
interface PeticionDelSdk {
  headers: Record<string, unknown>;
  url?: string;
}

/**
 * Lo único que nos hace falta del cliente de axios que el SDK lleva dentro:
 * apagar su interceptor y poner el nuestro. Sus propios tipos no llegan
 * resueltos hasta aquí, y no vale la pena arrastrar axios entero.
 */
interface ClienteDelSdk {
  request?: {
    interceptors?: {
      request?: {
        clear?: () => void;
        use?: (
          alSalir: (peticion: PeticionDelSdk) => Promise<PeticionDelSdk>,
        ) => void;
      };
    };
  };
}

/** One account movement, reduced to what payment confirmation needs. */
export interface TropipayMovement {
  reference?: string;
  state?: number;
  completedAt?: string | null;
  bankOrderCode?: string;
  amount?: number;
  originalCurrencyAmount?: string | number;
  [key: string]: unknown;
}

/**
 * Thin wrapper around the Tropipay SDK: one lazily-built instance, the session
 * kept fresh here, plus the signature check. Everything payment-shaped lives
 * in TropipayGateway.
 */
@Injectable()
export class TropipayClient implements OnModuleInit {
  private readonly logger = new Logger(TropipayClient.name);
  private instance: Tropipay | null = null;

  /**
   * Cada cuánto se vuelve a autenticar, en milisegundos. El porqué de no usar
   * el `expires_in` de la pasarela está en `asegurarSesion`.
   */
  private static readonly VIGENCIA_MS = 30 * 60 * 1000;

  /** Cuándo toca volver a autenticarse, en milisegundos desde la época. */
  private renovarDespuesDe = 0;

  /**
   * La autenticación en curso, si la hay. Sin esto, dos compras simultáneas
   * tras caducar la vigencia piden dos sesiones a la vez y la segunda invalida
   * el token de la primera.
   */
  private sesionEnCurso: Promise<void> | null = null;

  /**
   * La ruta por la que el SDK pide la sesión. Es la única petición que sale sin
   * firmar: firmarla sería pedir una sesión para poder pedir una sesión.
   *
   * Se compara por el final y no por la ruta entera a propósito. La 0.2.3 la
   * tenía bajo `/api/v2` y la 0.3.1 bajo `/api/v3`; lo que no ha cambiado
   * nunca es el `/access/token`.
   */
  private static readonly FINAL_DE_LA_RUTA_DEL_TOKEN = '/access/token';

  constructor(private readonly configService: ConfigService) {}

  /**
   * Warm the OAuth token in the background. The login round-trip costs seconds
   * against the gateway and the SDK caches the token, so paying it at boot
   * keeps it off the first customer's checkout. Never awaited and never fatal:
   * an unreachable gateway must not hold up or break startup.
   */
  onModuleInit(): void {
    if (!this.config.configured) return;

    void this.autenticar().catch((err: unknown) =>
      this.logger.warn(
        `Could not pre-authenticate with Tropipay: ${
          err instanceof Error ? err.message : String(err)
        }`,
      ),
    );
  }

  get config(): TropipayConfig {
    return this.configService.get<PaymentsConfig>('payments')!.tropipay;
  }

  private get sdk(): Tropipay {
    if (!this.config.configured) {
      throw new Error('Tropipay is not configured');
    }
    this.instance ??= this.nuevaInstancia();
    return this.instance;
  }

  private nuevaInstancia(): Tropipay {
    const instancia = new Tropipay({
      clientId: this.config.clientId as string,
      clientSecret: this.config.clientSecret as string,
      serverMode: this.config.serverMode,
      scopes: [
        'ALLOW_GET_PROFILE_DATA',
        'ALLOW_PAYMENT_IN',
        'ALLOW_EXTERNAL_CHARGE',
        'ALLOW_GET_BALANCE',
        'ALLOW_GET_MOVEMENT_LIST',
      ],
    });
    this.ponerNuestroInterceptor(instancia);
    return instancia;
  }

  /**
   * Cambia el interceptor del SDK por uno nuestro.
   *
   * **Por qué no vale ninguno de los dos extremos.**
   *
   * *Dejar el suyo* no vale. Decide que el token caducó comparando `expiresIn`
   * con la hora actual en segundos, y ahí guarda el `expires_in` tal como llega
   * de la pasarela; si eso es una duración y no un instante, la comparación da
   * «caducado» en todas y cada una de las peticiones. Y la renovación que
   * dispara entra por el camino del `refresh_token`, que contra nuestra cuenta
   * responde «App not found» (ver `autenticar`).
   *
   * *Quitarlo sin más* tampoco, y esto es lo que cambia respecto a la 0.2.3.
   * Allí `paymentCards.create` y `movements` se autenticaban solos y ponían
   * `Authorization` ellos mismos, así que el PR #85 pudo apagar el interceptor
   * y no perder nada. En la 0.3.1 esos métodos son un `request.post` pelado:
   * **la cabecera la pone únicamente el interceptor**. Sin él, todo responde
   * 401.
   *
   * Así que ponemos uno que hace lo que necesitamos y nada más: deja salir la
   * petición del token, se asegura de que haya sesión fresca, y firma.
   */
  private ponerNuestroInterceptor(instancia: Tropipay): void {
    const cliente = instancia as unknown as ClienteDelSdk;
    cliente.request?.interceptors?.request?.clear?.();
    cliente.request?.interceptors?.request?.use?.(async (peticion) => {
      if (this.esLaPeticionDelToken(peticion)) return peticion;
      await this.asegurarSesion();
      peticion.headers = {
        ...peticion.headers,
        Authorization: `Bearer ${instancia.accessToken}`,
      };
      return peticion;
    });
  }

  /**
   * Se mira la ruta, y no si hay una autenticación en marcha, porque una
   * compra que caiga justo mientras se renueva la sesión es una petición
   * normal: tiene que esperar y salir firmada, no colarse sin cabecera y
   * recibir un 401.
   */
  private esLaPeticionDelToken(peticion: PeticionDelSdk): boolean {
    return (
      typeof peticion.url === 'string' &&
      peticion.url.endsWith(TropipayClient.FINAL_DE_LA_RUTA_DEL_TOKEN)
    );
  }

  /**
   * Deja una sesión utilizable, sin pedir dos a la vez.
   *
   * La vigencia la contamos nosotros y no con el `expires_in` de la pasarela,
   * porque el SDK lo guarda tal cual llega y lo compara con una marca de
   * tiempo, así que desde fuera no hay forma de saber si es una duración o un
   * instante. Media hora queda corta frente a cualquiera de las dos lecturas.
   */
  private async asegurarSesion(): Promise<void> {
    if (this.sdk.accessToken && Date.now() < this.renovarDespuesDe) return;
    this.sesionEnCurso ??= this.autenticar().finally(() => {
      this.sesionEnCurso = null;
    });
    await this.sesionEnCurso;
  }

  /**
   * Se autentica **siempre con clientId y clientSecret**, nunca con el
   * `refresh_token` que el SDK guardó de la vez anterior.
   *
   * `login()` elige el camino mirando si tiene un `refresh_token` a mano, y
   * contra nuestra cuenta ese camino responde **«App not found»**: medido en
   * staging el 20-oct-2026, la primera renovación tras media hora dejaba la
   * tarjeta sin poder cobrar, mientras que el arranque —que no tiene
   * `refresh_token` todavía— entraba sin problema. La 0.3.1 no cambia nada de
   * esto: su `login()` sigue prefiriendo el refresco en cuanto lo tiene.
   *
   * Para un servidor el refresco no aporta nada: las credenciales están aquí
   * y pedir una sesión nueva cuesta lo mismo. Es un camino menos que puede
   * romperse.
   */
  private async autenticar(): Promise<void> {
    const instancia = this.sdk;
    instancia.refreshToken = null;
    await instancia.login();
    this.renovarDespuesDe = Date.now() + TropipayClient.VIGENCIA_MS;
  }

  async createPaymentLink(payload: PaymentLinkPayload): Promise<PaymentLink> {
    try {
      return await this.sdk.paymentCards.create(payload);
    } catch (err) {
      // The top-level message is always "Invalid Parameter"; `details` is the
      // only place the rejected field appears.
      const details = (err as { error?: { details?: unknown } })?.error
        ?.details;
      this.logger.error(
        `Tropipay payment link rejected: ${(err as Error).message}`,
        details ? JSON.stringify(details) : undefined,
      );
      throw err;
    }
  }

  /**
   * Recent account movements. There is no "get transaction by reference"
   * endpoint, so confirmation scans a recent page for our own reference.
   */
  async findMovementByReference(
    reference: string,
  ): Promise<TropipayMovement | undefined> {
    const result = (await this.sdk.movements(0, 50)) as
      | TropipayMovement[]
      | { rows?: TropipayMovement[] };
    const rows = Array.isArray(result) ? result : (result?.rows ?? []);
    return rows.find((row) => row.reference === reference);
  }

  verifySignature(
    originalCurrencyAmount: string,
    bankOrderCode: string,
    signature: string,
  ): boolean {
    return ServerSideUtils.verifySignature(
      {
        clientId: this.config.clientId as string,
        clientSecret: this.config.clientSecret as string,
      },
      originalCurrencyAmount,
      bankOrderCode,
      signature,
    );
  }
}
