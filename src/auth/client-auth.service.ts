import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { Client } from '../clients/entities/client.entity';
import { ClientRecoveryService } from '../clients/client-recovery.service';
import { ClientsService } from '../clients/clients.service';
import {
  AUTH_PROVIDER,
  AuthProvider,
} from './interfaces/auth-provider.interface';

@Injectable()
export class ClientAuthService {
  constructor(
    private readonly clientsService: ClientsService,
    private readonly clientRecovery: ClientRecoveryService,
    @Inject(AUTH_PROVIDER) private readonly authProvider: AuthProvider,
  ) {}

  async authenticateByBearerToken(token: string): Promise<Client> {
    let clerkId: string;

    try {
      clerkId = (await this.authProvider.verifyToken(token)).sub;
    } catch {
      throw new UnauthorizedException('Invalid access token');
    }

    // withDeleted: soft-deleted clients must resolve so they get the
    // "inactive" error instead of the misleading "not registered" one.
    const client =
      (await this.clientsService.findByClerkId(clerkId, {
        withDeleted: true,
      })) ??
      // Sin fila no hay tienda, y el alta depende de un webhook que puede
      // perderse. Antes de rechazar, se le pregunta a Clerk si esta persona es
      // cliente: si lo es, se le crea la fila que el webhook no trajo. Nunca al
      // revés — quien no esté en la instancia de la tienda no se da de alta.
      (await this.clientRecovery.recuperarDesdeClerk(clerkId));

    if (!client) {
      throw new UnauthorizedException('Client not registered');
    }
    // Soft-deleted, or gated (e.g. an admin-invite mirror still awaiting
    // approval) — both are blocked with the same "inactive" message.
    if (client.deletedAt || !client.isActive) {
      throw new UnauthorizedException('Account is inactive');
    }

    return client;
  }
}
