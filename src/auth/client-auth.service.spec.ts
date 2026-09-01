import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { ClientAuthService } from './client-auth.service';
import { ClientsService } from '../clients/clients.service';
import { ClientRecoveryService } from '../clients/client-recovery.service';
import { AUTH_PROVIDER } from './interfaces/auth-provider.interface';
import { Client } from '../clients/entities/client.entity';

describe('ClientAuthService', () => {
  let service: ClientAuthService;
  let findByClerkId: jest.Mock;
  let recuperarDesdeClerk: jest.Mock;

  const cliente = { id: 'c1', clerkId: 'user_1', isActive: true } as Client;

  beforeEach(async () => {
    findByClerkId = jest.fn().mockResolvedValue(null);
    recuperarDesdeClerk = jest.fn().mockResolvedValue(null);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClientAuthService,
        { provide: ClientsService, useValue: { findByClerkId } },
        {
          provide: ClientRecoveryService,
          useValue: { recuperarDesdeClerk },
        },
        {
          provide: AUTH_PROVIDER,
          useValue: {
            verifyToken: jest.fn().mockResolvedValue({ sub: 'user_1' }),
          },
        },
      ],
    }).compile();

    service = module.get(ClientAuthService);
  });

  it('devuelve el cliente que ya tiene fila, sin preguntarle a Clerk', async () => {
    findByClerkId.mockResolvedValue(cliente);

    await expect(service.authenticateByBearerToken('t')).resolves.toBe(cliente);
    expect(recuperarDesdeClerk).not.toHaveBeenCalled();
  });

  /**
   * El caso de las 28 personas: sesión válida, sin fila, y hasta ahora un 401
   * en todo lo autenticado. Podían entrar y no podían comprar.
   */
  it('da de alta al vuelo a quien no tiene fila y es cliente de la tienda', async () => {
    recuperarDesdeClerk.mockResolvedValue(cliente);

    await expect(service.authenticateByBearerToken('t')).resolves.toBe(cliente);
    expect(recuperarDesdeClerk).toHaveBeenCalledWith('user_1');
  });

  it('sigue rechazando a quien no es cliente de la tienda', async () => {
    await expect(service.authenticateByBearerToken('t')).rejects.toThrow(
      new UnauthorizedException('Client not registered'),
    );
  });

  // Una baja no se deshace sola: la fila existe, así que no se recupera nada y
  // el mensaje sigue siendo el de cuenta inactiva.
  it('a un cliente dado de baja no lo resucita', async () => {
    findByClerkId.mockResolvedValue({
      ...cliente,
      deletedAt: new Date(),
    } as Client);

    await expect(service.authenticateByBearerToken('t')).rejects.toThrow(
      new UnauthorizedException('Account is inactive'),
    );
    expect(recuperarDesdeClerk).not.toHaveBeenCalled();
  });

  // El espejo de un administrador invitado nace desactivado a propósito.
  it('a un cliente desactivado tampoco lo reactiva', async () => {
    findByClerkId.mockResolvedValue({ ...cliente, isActive: false } as Client);

    await expect(service.authenticateByBearerToken('t')).rejects.toThrow(
      new UnauthorizedException('Account is inactive'),
    );
    expect(recuperarDesdeClerk).not.toHaveBeenCalled();
  });
});
