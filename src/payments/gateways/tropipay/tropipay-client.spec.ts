import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { TropipayClient } from './tropipay-client';

const login = jest.fn<Promise<unknown>, unknown[]>();

jest.mock('@yosle/tropipayjs', () => ({
  Tropipay: jest.fn().mockImplementation(() => ({
    login: (...args: unknown[]): Promise<unknown> => login(...args),
    paymentCards: { create: jest.fn() },
    movements: jest.fn(),
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
});
