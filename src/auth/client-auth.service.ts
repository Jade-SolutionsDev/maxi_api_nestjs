import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { Client } from '../clients/entities/client.entity';
import { ClientsService } from '../clients/clients.service';
import {
  AUTH_PROVIDER,
  AuthProvider,
} from './interfaces/auth-provider.interface';

@Injectable()
export class ClientAuthService {
  constructor(
    private readonly clientsService: ClientsService,
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
    const client = await this.clientsService.findByClerkId(clerkId, {
      withDeleted: true,
    });
    if (!client) {
      throw new UnauthorizedException('Client not registered');
    }
    if (client.deletedAt) {
      throw new UnauthorizedException('Account is inactive');
    }

    return client;
  }
}
