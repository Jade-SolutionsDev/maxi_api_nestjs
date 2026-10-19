import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { createClerkClient } from '@clerk/backend';
import { ClientReconciliationService } from './client-reconciliation.service';
import { ClientsService } from './clients.service';

jest.mock('@clerk/backend', () => ({
  createClerkClient: jest.fn(),
}));

const crearClienteDeClerk = createClerkClient as jest.MockedFunction<
  typeof createClerkClient
>;

const usuario = (id: string, email: string) => ({
  id,
  firstName: 'Yurkisabel',
  lastName: 'Monagas',
  primaryEmailAddressId: `idn_${id}`,
  emailAddresses: [{ id: `idn_${id}`, emailAddress: email }],
});

describe('ClientReconciliationService', () => {
  let service: ClientReconciliationService;
  let clientsService: {
    findByClerkId: jest.Mock;
    createOrUpdateFromClerk: jest.Mock;
  };
  let getUserList: jest.Mock;
  let claves: Record<string, string | undefined>;

  const montar = async () => {
    crearClienteDeClerk.mockReturnValue({
      users: { getUserList },
    } as unknown as ReturnType<typeof createClerkClient>);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClientReconciliationService,
        { provide: ClientsService, useValue: clientsService },
        {
          provide: ConfigService,
          useValue: { get: (clave: string) => claves[clave] },
        },
      ],
    }).compile();

    service = module.get(ClientReconciliationService);
  };

  beforeEach(async () => {
    claves = { 'clerk.secretKey': 'sk_tienda' };
    getUserList = jest.fn().mockResolvedValue({
      data: [
        usuario('user_1', 'uno@example.com'),
        usuario('user_2', 'dos@example.com'),
      ],
    });
    clientsService = {
      // Solo el primero tiene fila.
      findByClerkId: jest
        .fn()
        .mockImplementation((clerkId: string) =>
          clerkId === 'user_1' ? { id: 'fila-1', clerkId } : null,
        ),
      createOrUpdateFromClerk: jest
        .fn()
        .mockImplementation((clerkId: string) => ({ id: 'nueva', clerkId })),
    };
    await montar();
  });

  it('cuenta a quien falta y no escribe nada mientras solo informa', async () => {
    const informe = await service.reconciliar();

    expect(informe).toMatchObject({
      enClerk: 2,
      conFila: 1,
      sinFila: 1,
      creados: 0,
      soloInforme: true,
    });
    expect(informe.faltantes).toEqual([
      { clerkId: 'user_2', email: 'dos@example.com', creado: false },
    ]);
    expect(clientsService.createOrUpdateFromClerk).not.toHaveBeenCalled();
  });

  it('da de alta solo al que no tiene fila cuando se le pide aplicar', async () => {
    const informe = await service.reconciliar(false);

    expect(informe).toMatchObject({ sinFila: 1, creados: 1 });
    expect(clientsService.createOrUpdateFromClerk).toHaveBeenCalledTimes(1);
    expect(clientsService.createOrUpdateFromClerk).toHaveBeenCalledWith(
      'user_2',
      {
        email: 'dos@example.com',
        firstName: 'Yurkisabel',
        lastName: 'Monagas',
      },
    );
  });

  it('ve también a quien tiene la fila borrada, y no la duplica', async () => {
    clientsService.findByClerkId.mockResolvedValue({
      id: 'fila-borrada',
      deletedAt: new Date(),
    });

    const informe = await service.reconciliar(false);

    expect(informe).toMatchObject({ conFila: 2, sinFila: 0, creados: 0 });
    expect(clientsService.findByClerkId).toHaveBeenCalledWith(
      'user_1',
      expect.objectContaining({ withDeleted: true }),
    );
  });

  it('un correo repetido se anota como conflicto y la pasada sigue', async () => {
    getUserList.mockResolvedValue({
      data: [
        usuario('user_2', 'dos@example.com'),
        usuario('user_3', 'tres@example.com'),
      ],
    });
    clientsService.findByClerkId.mockResolvedValue(null);
    clientsService.createOrUpdateFromClerk
      .mockRejectedValueOnce(new Error('Ya existe un cliente con ese correo'))
      .mockResolvedValueOnce({ id: 'nueva' });

    const informe = await service.reconciliar(false);

    expect(informe.creados).toBe(1);
    expect(informe.conflictos).toEqual([
      {
        clerkId: 'user_2',
        email: 'dos@example.com',
        motivo: 'Ya existe un cliente con ese correo',
      },
    ]);
  });

  it('recorre todas las páginas de Clerk, no solo la primera', async () => {
    const primera = Array.from({ length: 100 }, (_, i) =>
      usuario(`user_p1_${i}`, `p1_${i}@example.com`),
    );
    getUserList
      .mockResolvedValueOnce({ data: primera })
      .mockResolvedValueOnce({ data: [usuario('user_p2', 'p2@example.com')] });
    clientsService.findByClerkId.mockResolvedValue({ id: 'ya-estaba' });

    const informe = await service.reconciliar();

    expect(informe.enClerk).toBe(101);
    expect(getUserList).toHaveBeenNthCalledWith(1, { limit: 100, offset: 0 });
    expect(getUserList).toHaveBeenNthCalledWith(2, { limit: 100, offset: 100 });
  });

  it('sin clave de Clerk no da de alta a nadie: falla en vez de adivinar', async () => {
    claves = {};
    await montar();

    await expect(service.reconciliar(false)).rejects.toThrow(
      'CLERK_SECRET_KEY',
    );
    expect(clientsService.createOrUpdateFromClerk).not.toHaveBeenCalled();
  });
});
