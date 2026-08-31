import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { createClerkClient } from '@clerk/backend';
import { ClientRecoveryService } from './client-recovery.service';
import { ClientsService } from './clients.service';

jest.mock('@clerk/backend', () => ({
  createClerkClient: jest.fn(),
}));

const crearClienteDeClerk = createClerkClient as jest.MockedFunction<
  typeof createClerkClient
>;

describe('ClientRecoveryService', () => {
  let service: ClientRecoveryService;
  let clientsService: { createOrUpdateFromClerk: jest.Mock };
  let getUser: jest.Mock;
  let claves: Record<string, string | undefined>;

  const usuarioDeClerk = {
    id: 'user_tienda_1',
    firstName: 'Yurkisabel',
    lastName: 'Monagas',
    primaryEmailAddressId: 'idn_1',
    emailAddresses: [
      { id: 'idn_0', emailAddress: 'vieja@example.com' },
      { id: 'idn_1', emailAddress: 'Yurki@Example.com' },
    ],
  };

  beforeEach(async () => {
    claves = { 'clerk.secretKey': 'sk_tienda' };
    getUser = jest.fn().mockResolvedValue(usuarioDeClerk);
    crearClienteDeClerk.mockReturnValue({
      users: { getUser },
    } as unknown as ReturnType<typeof createClerkClient>);

    clientsService = {
      createOrUpdateFromClerk: jest
        .fn()
        .mockImplementation((clerkId: string, data: object) => ({
          id: 'fila-nueva',
          clerkId,
          ...data,
        })),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClientRecoveryService,
        { provide: ClientsService, useValue: clientsService },
        {
          provide: ConfigService,
          useValue: { get: (clave: string) => claves[clave] },
        },
      ],
    }).compile();

    service = module.get(ClientRecoveryService);
  });

  it('da de alta a quien existe en la Clerk de la tienda', async () => {
    const cliente = await service.recuperarDesdeClerk('user_tienda_1');

    expect(cliente).not.toBeNull();
    expect(clientsService.createOrUpdateFromClerk).toHaveBeenCalledWith(
      'user_tienda_1',
      expect.objectContaining({
        firstName: 'Yurkisabel',
        lastName: 'Monagas',
      }),
    );
  });

  it('usa el correo principal, no el primero de la lista', async () => {
    await service.recuperarDesdeClerk('user_tienda_1');

    const [, datos] = clientsService.createOrUpdateFromClerk.mock.calls[0] as [
      string,
      { email: string },
    ];
    expect(datos.email).toBe('Yurki@Example.com');
  });

  /**
   * La comprobación de la que depende todo: `verifyToken` acepta tokens de las
   * dos instancias de Clerk, así que hasta aquí llega el `sub` de un
   * administrador igual que el de un cliente. Si esto diera de alta, un token
   * del backoffice se convertiría en un cliente de la tienda, saltándose el
   * espejo que los crea desactivados hasta que se aprueban.
   */
  it('no da de alta a quien no está en la Clerk de la tienda', async () => {
    getUser.mockRejectedValue(new Error('404 Not Found'));

    const cliente = await service.recuperarDesdeClerk('user_backoffice_1');

    expect(cliente).toBeNull();
    expect(clientsService.createOrUpdateFromClerk).not.toHaveBeenCalled();
  });

  // Sin clave no se puede comprobar a quién se daría de alta, y dar de alta sin
  // comprobarlo es exactamente lo que no puede pasar. Ver D-020.
  it('sin CLERK_SECRET_KEY no da de alta a nadie', async () => {
    claves = {};

    const cliente = await service.recuperarDesdeClerk('user_tienda_1');

    expect(cliente).toBeNull();
    expect(getUser).not.toHaveBeenCalled();
    expect(clientsService.createOrUpdateFromClerk).not.toHaveBeenCalled();
  });
});
