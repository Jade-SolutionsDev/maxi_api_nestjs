import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { TropipayClient } from './tropipay-client';

const login = jest.fn<Promise<unknown>, unknown[]>();
const crearEnlace = jest.fn<Promise<unknown>, unknown[]>();
const movimientos = jest.fn<Promise<unknown>, unknown[]>();
const limpiarInterceptores = jest.fn();

jest.mock('@yosle/tropipayjs', () => ({
  Tropipay: jest.fn().mockImplementation(() => ({
    login: (...args: unknown[]): Promise<unknown> => login(...args),
    paymentCards: {
      create: (...args: unknown[]): Promise<unknown> => crearEnlace(...args),
    },
    movements: (...args: unknown[]): Promise<unknown> => movimientos(...args),
    request: { interceptors: { request: { clear: limpiarInterceptores } } },
  })),
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

  beforeEach(async () => {
    login.mockReset().mockResolvedValue({ access_token: 'tok' });
    crearEnlace.mockReset().mockResolvedValue({ shortUrl: 'https://x/y' });
    movimientos.mockReset().mockResolvedValue([]);
    limpiarInterceptores.mockReset();
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

    expect(login).toHaveBeenCalled();
  });

  it('does not block startup on the gateway', () => {
    login.mockReturnValue(new Promise(() => {}));

    expect(client.onModuleInit()).toBeUndefined();
  });

  it('survives an unreachable gateway at boot', async () => {
    login.mockRejectedValue(new Error('ENOTFOUND'));

    expect(() => client.onModuleInit()).not.toThrow();
    await Promise.resolve();
  });

  it('stays quiet when no credentials are configured', () => {
    tropipay.configured = false;

    client.onModuleInit();

    expect(login).not.toHaveBeenCalled();
  });

  /**
   * MxH-0166. El interceptor del SDK renueva el token llamando a `login()`, y
   * `login()` manda su POST por el mismo cliente de axios, así que se vuelve a
   * disparar a sí mismo hasta agotar el montón: 70 MB a 4 GB en menos de un
   * minuto, y el proceso entero muerto. Aquí se exige que la instancia nazca
   * sin ese interceptor.
   */
  it('deja al SDK sin el interceptor que se llama a sí mismo', async () => {
    await client.createPaymentLink({} as never);

    expect(limpiarInterceptores).toHaveBeenCalled();
  });

  it('se autentica antes de la primera llamada a la pasarela', async () => {
    await client.createPaymentLink({} as never);

    expect(login).toHaveBeenCalledTimes(1);
    expect(crearEnlace).toHaveBeenCalled();
  });

  // Quitado el interceptor, la frescura del token es cosa nuestra: sin esto
  // un token viejo daría 401 y el cliente leería que no puede pagar.
  it('renueva la sesión cuando ha pasado la vigencia', async () => {
    const reloj = jest.spyOn(Date, 'now');
    reloj.mockReturnValue(0);
    await client.createPaymentLink({} as never);
    expect(login).toHaveBeenCalledTimes(1);

    reloj.mockReturnValue(29 * 60 * 1000);
    await client.createPaymentLink({} as never);
    expect(login).toHaveBeenCalledTimes(1);

    reloj.mockReturnValue(31 * 60 * 1000);
    await client.createPaymentLink({} as never);
    expect(login).toHaveBeenCalledTimes(2);

    reloj.mockRestore();
  });

  it('también deja la sesión fresca para consultar los movimientos', async () => {
    await client.findMovementByReference('ref-1');

    expect(login).toHaveBeenCalledTimes(1);
    expect(movimientos).toHaveBeenCalledWith(0, 50);
  });
});
