import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { TropipayClient } from './tropipay-client';

/** Una petición saliente, como la ve el interceptor. */
interface PeticionFalsa {
  headers: Record<string, unknown>;
  url?: string;
}

type Interceptor = (peticion: PeticionFalsa) => Promise<PeticionFalsa>;

const crearEnlace = jest.fn<Promise<unknown>, unknown[]>();
const movimientos = jest.fn<Promise<unknown>, unknown[]>();
const limpiarInterceptores = jest.fn();

/**
 * El interceptor que nuestro código registra. Es la pieza que cambió al subir
 * a 0.3.1 —allí la cabecera la pone solo el interceptor—, así que las pruebas
 * lo invocan directamente, que es como lo invocaría axios.
 */
let interceptor: Interceptor | null = null;

/** La instancia del SDK, con el estado de sesión que el SDK de verdad lleva. */
let sdk: {
  accessToken: string | null;
  refreshToken: string | null;
  expiresIn: number | null;
  login: jest.Mock;
  paymentCards: { create: (...args: unknown[]) => Promise<unknown> };
  movements: (...args: unknown[]) => Promise<unknown>;
  request: { interceptors: { request: { clear: jest.Mock; use: jest.Mock } } };
};

jest.mock('@yosle/tropipayjs', () => ({
  Tropipay: jest.fn().mockImplementation(() => sdk),
  ServerSideUtils: { verifySignature: jest.fn() },
}));

describe('TropipayClient', () => {
  let client: TropipayClient;
  let tropipay: Record<string, unknown>;

  const build = async (): Promise<TropipayClient> => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TropipayClient,
        {
          provide: ConfigService,
          useValue: { get: jest.fn(() => ({ tropipay })) },
        },
      ],
    }).compile();
    return module.get(TropipayClient);
  };

  /** Dispara la construcción perezosa de la instancia y del interceptor. */
  const forzarInstancia = async (): Promise<void> => {
    await client.findMovementByReference('cualquiera');
  };

  beforeEach(async () => {
    interceptor = null;
    crearEnlace.mockReset().mockResolvedValue({ shortUrl: 'https://x/y' });
    movimientos.mockReset().mockResolvedValue([]);
    limpiarInterceptores.mockReset();

    sdk = {
      accessToken: null,
      refreshToken: null,
      expiresIn: null,
      // El SDK de verdad guarda las dos cosas al autenticarse, y es por eso
      // que en la siguiente renovación el refresco estorba.
      login: jest.fn().mockImplementation(() => {
        sdk.accessToken = 'tok';
        sdk.refreshToken = 'del-login-anterior';
        return Promise.resolve({ access_token: 'tok' });
      }),
      paymentCards: {
        create: (...args: unknown[]): Promise<unknown> => crearEnlace(...args),
      },
      movements: (...args: unknown[]): Promise<unknown> => movimientos(...args),
      request: {
        interceptors: {
          request: {
            clear: limpiarInterceptores,
            use: jest.fn((fn: Interceptor) => {
              interceptor = fn;
            }),
          },
        },
      },
    };

    tropipay = {
      configured: true,
      clientId: 'id',
      clientSecret: 'secret',
      serverMode: 'Development',
      currency: 'USD',
    };
    client = await build();
  });

  // The OAuth login costs ~3s against the sandbox. Paying it at boot keeps it
  // off the first customer's checkout.
  it('warms the access token on startup', async () => {
    client.onModuleInit();
    await Promise.resolve();

    expect(sdk.login).toHaveBeenCalled();
  });

  it('does not block startup on the gateway', () => {
    sdk.login.mockReturnValue(new Promise(() => {}));

    expect(client.onModuleInit()).toBeUndefined();
  });

  it('survives an unreachable gateway at boot', async () => {
    sdk.login.mockRejectedValue(new Error('ENOTFOUND'));

    expect(() => client.onModuleInit()).not.toThrow();
    await Promise.resolve();
  });

  it('stays quiet when no credentials are configured', () => {
    tropipay.configured = false;

    client.onModuleInit();

    expect(sdk.login).not.toHaveBeenCalled();
  });

  /**
   * MxH-0180. En la 0.2.3, `paymentCards.create` y `movements` se autenticaban
   * solos y ponían `Authorization` ellos mismos, así que se podía apagar el
   * interceptor sin perder nada (PR #85). En la 0.3.1 son un `request.post`
   * pelado: si el interceptor no firma, la pasarela responde 401 y el cliente
   * lee «no se puede pagar con tarjeta» con las credenciales perfectamente
   * bien.
   */
  it('firma cada petición que sale hacia la pasarela', async () => {
    await forzarInstancia();

    const peticion = await interceptor!({ headers: {} });

    expect(peticion.headers.Authorization).toBe('Bearer tok');
  });

  it('cambia el interceptor del SDK por el nuestro', async () => {
    await forzarInstancia();

    expect(limpiarInterceptores).toHaveBeenCalled();
    expect(interceptor).not.toBeNull();
  });

  /**
   * MxH-0166. El interceptor de la 0.2.3 renovaba el token llamando a
   * `login()`, y `login()` mandaba su POST por el mismo cliente de axios: se
   * disparaba a sí mismo hasta agotar el montón —70 MB a 4 GB en menos de un
   * minuto— y el proceso moría. Aquí se exige que la petición de la sesión no
   * vuelva a entrar pidiendo una sesión.
   */
  it('deja salir la petición del token sin pedirle una sesión', async () => {
    await forzarInstancia();
    sdk.login.mockClear();
    sdk.accessToken = null;

    const peticion = await interceptor!({
      headers: {},
      url: '/api/v3/access/token',
    });

    expect(peticion.headers.Authorization).toBeUndefined();
    expect(sdk.login).not.toHaveBeenCalled();
  });

  /**
   * La ruta del token estaba bajo `/api/v2` en la 0.2.3 y bajo `/api/v3` en la
   * 0.3.1. Reconocerla por el final y no por la ruta completa es lo que hace
   * que un salto de versión como éste no vuelva a romper nada.
   */
  it('reconoce la ruta del token aunque cambie la versión de la API', async () => {
    await forzarInstancia();
    sdk.login.mockClear();
    sdk.accessToken = null;

    await interceptor!({ headers: {}, url: '/api/v9/access/token' });

    expect(sdk.login).not.toHaveBeenCalled();
  });

  /**
   * El fallo que esto fija: distinguir la petición del token por «hay una
   * autenticación en marcha» metía en el mismo saco a una compra que cayera
   * justo en ese momento, y salía sin cabecera. La pasarela respondía 401 y el
   * cliente leía que no podía pagar con tarjeta.
   */
  it('firma la compra que cae mientras se renueva la sesión', async () => {
    await forzarInstancia();
    sdk.accessToken = null;

    let resolver: (() => void) | undefined;
    sdk.login.mockImplementation(
      () =>
        new Promise<unknown>((resuelve) => {
          resolver = (): void => {
            sdk.accessToken = 'tok-nuevo';
            resuelve({ access_token: 'tok-nuevo' });
          };
        }),
    );

    // Entra mientras el login está en el aire, sin ser la petición del token.
    const compra = interceptor!({ headers: {}, url: '/api/v3/paymentcards' });
    resolver!();

    expect((await compra).headers.Authorization).toBe('Bearer tok-nuevo');
  });

  it('se autentica antes de la primera llamada a la pasarela', async () => {
    await forzarInstancia();
    await interceptor!({ headers: {} });

    expect(sdk.login).toHaveBeenCalledTimes(1);
  });

  // La frescura del token es cosa nuestra: el `expires_in` del SDK no se sabe
  // si es duración o instante, y un token viejo daría 401.
  it('renueva la sesión cuando ha pasado la vigencia', async () => {
    const reloj = jest.spyOn(Date, 'now');
    reloj.mockReturnValue(0);
    await forzarInstancia();
    await interceptor!({ headers: {} });
    expect(sdk.login).toHaveBeenCalledTimes(1);

    reloj.mockReturnValue(29 * 60 * 1000);
    await interceptor!({ headers: {} });
    expect(sdk.login).toHaveBeenCalledTimes(1);

    reloj.mockReturnValue(31 * 60 * 1000);
    await interceptor!({ headers: {} });
    expect(sdk.login).toHaveBeenCalledTimes(2);

    reloj.mockRestore();
  });

  /**
   * MxH-0166, segunda parte, y la 0.3.1 no la arregla: su `login()` sigue
   * prefiriendo el `refresh_token` en cuanto lo tiene, y contra nuestra cuenta
   * ese camino responde «App not found». Medido en staging el 20-oct-2026: la
   * primera renovación tras media hora dejó un pedido sin poder cobrarse.
   */
  it('se autentica con las credenciales, nunca con el token de refresco', async () => {
    await forzarInstancia();
    sdk.refreshToken = 'del-login-anterior';

    // El refresco tiene que estar descartado *antes* de que login() mire.
    let refrescoAlEntrar: string | null = 'sin-medir';
    sdk.login.mockImplementation(() => {
      refrescoAlEntrar = sdk.refreshToken;
      sdk.accessToken = 'tok';
      sdk.refreshToken = 'nuevo';
      return Promise.resolve({ access_token: 'tok' });
    });

    const reloj = jest.spyOn(Date, 'now');
    reloj.mockReturnValue(31 * 60 * 1000);
    await interceptor!({ headers: {} });
    reloj.mockRestore();

    expect(refrescoAlEntrar).toBeNull();
  });

  /**
   * Dos compras a la vez justo después de caducar la vigencia pedían dos
   * sesiones, y la segunda invalida el token de la primera.
   */
  it('no pide dos sesiones a la vez', async () => {
    await forzarInstancia();
    sdk.login.mockClear();
    sdk.accessToken = null;

    let resolver: (() => void) | undefined;
    sdk.login.mockImplementation(
      () =>
        new Promise<unknown>((resuelve) => {
          resolver = (): void => {
            sdk.accessToken = 'tok';
            resuelve({ access_token: 'tok' });
          };
        }),
    );

    const a = interceptor!({ headers: {} });
    const b = interceptor!({ headers: {} });
    resolver!();
    await Promise.all([a, b]);

    expect(sdk.login).toHaveBeenCalledTimes(1);
  });

  it('también deja la sesión fresca para consultar los movimientos', async () => {
    await client.findMovementByReference('ref-1');

    expect(movimientos).toHaveBeenCalledWith(0, 50);
  });
});
