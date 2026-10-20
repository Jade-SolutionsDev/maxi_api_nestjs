import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  type PaymentLink,
  type PaymentLinkPayload,
  ServerSideUtils,
  Tropipay,
} from '@yosle/tropipayjs';
import { PaymentsConfig, TropipayConfig } from '../../../config/configuration';

/**
 * Lo único que nos hace falta del cliente de axios que el SDK lleva dentro.
 * Sus propios tipos no llegan resueltos hasta aquí, y para apagar un
 * interceptor no vale la pena arrastrar axios entero.
 */
interface ClienteDelSdk {
  request?: { interceptors?: { request?: { clear?: () => void } } };
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
   * Cada cuánto se vuelve a autenticar, en milisegundos.
   *
   * No se usa el `expires_in` que devuelve la pasarela porque el SDK lo guarda
   * tal cual llega y su propio código lo compara con una marca de tiempo, así
   * que no hay forma de saber desde fuera si es una duración o un instante.
   * Media hora queda corta frente a cualquiera de las dos lecturas, y una
   * autenticación de más cada media hora no le cuesta nada a nadie.
   */
  private static readonly VIGENCIA_MS = 30 * 60 * 1000;

  /** Cuándo toca volver a autenticarse, en milisegundos desde la época. */
  private renovarDespuesDe = 0;

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
    this.quitarElRefrescoRecursivo(instancia);
    return instancia;
  }

  /**
   * El interceptor de peticiones del SDK renueva el token llamando a `login()`,
   * y `login()` manda su POST por este mismo cliente de axios: entra otra vez
   * en el interceptor, que lo vuelve a ver caducado, y así sin fondo.
   *
   * No es una fuga lenta. El montón pasa de 70 MB al techo de 4 GB en menos de
   * un minuto y Node muere con `heap out of memory`, llevándose por delante la
   * compra que lo disparó y todo lo demás que estuviera en marcha. En staging
   * pasaba cada madrugada con la primera compra de la suite; en producción, el
   * 14-oct-2026 (MxH-0166).
   *
   * Se quita entero. Los dos únicos métodos que usamos, `paymentCards.create` y
   * `movements`, ya se autentican solos si falta el token y ponen la cabecera
   * ellos mismos, así que el interceptor no hacía falta para nada más. De que
   * la sesión no envejezca se encarga `conSesion`.
   */
  private quitarElRefrescoRecursivo(instancia: Tropipay): void {
    const cliente = instancia as unknown as ClienteDelSdk;
    cliente.request?.interceptors?.request?.clear?.();
  }

  /**
   * Deja una sesión fresca y entonces habla con la pasarela.
   *
   * Hace falta porque sin el interceptor nadie renueva el token: con uno
   * caducado la pasarela respondería 401 y el cliente leería «no se puede
   * pagar con tarjeta» cuando sí se puede.
   */
  private async conSesion<T>(llamada: () => Promise<T>): Promise<T> {
    if (Date.now() >= this.renovarDespuesDe) await this.autenticar();
    return llamada();
  }

  /**
   * Se autentica **siempre con clientId y clientSecret**, nunca con el
   * `refresh_token` que el SDK guardó de la vez anterior.
   *
   * `login()` elige el camino mirando si tiene un `refresh_token` a mano, y
   * contra nuestra cuenta ese camino responde **«App not found»**: medido en
   * staging el 20-oct-2026, la primera renovación tras media hora dejaba la
   * tarjeta sin poder cobrar, mientras que el arranque —que no tiene
   * `refresh_token` todavía— entraba sin problema. Antes del PR #85 esto no
   * se veía nunca, porque la recursión del interceptor mataba el proceso
   * antes de que la petición llegara a salir.
   *
   * Para un servidor el refresco no aporta nada: las credenciales están aquí
   * y pedir una sesión nueva cuesta lo mismo. Es un camino menos que puede
   * romperse.
   */
  private async autenticar(): Promise<void> {
    Tropipay.refreshToken = null;
    await this.sdk.login();
    this.renovarDespuesDe = Date.now() + TropipayClient.VIGENCIA_MS;
  }

  async createPaymentLink(payload: PaymentLinkPayload): Promise<PaymentLink> {
    try {
      return await this.conSesion(() => this.sdk.paymentCards.create(payload));
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
    const result = (await this.conSesion(() => this.sdk.movements(0, 50))) as
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
