import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { verifyToken } from '@clerk/backend';
import { verify } from 'jsonwebtoken';
import { Client } from '../clients/entities/client.entity';
import { ClientsService } from '../clients/clients.service';

@Injectable()
export class ClientAuthService {
  constructor(
    private readonly clientsService: ClientsService,
    private readonly configService: ConfigService,
  ) {}

  async authenticateByBearerToken(token: string): Promise<Client> {
    let clerkId: string;

    try {
      clerkId = await this.verifyClerkToken(token);
    } catch {
      throw new UnauthorizedException('Invalid access token');
    }

    const client = await this.clientsService.findByClerkId(clerkId);
    if (!client) {
      throw new UnauthorizedException('Client not registered');
    }
    if (client.deletedAt) {
      throw new UnauthorizedException('Account is inactive');
    }

    return client;
  }

  private async verifyClerkToken(token: string): Promise<string> {
    const secretKey = this.configService.get<string>('clerk.secretKey');

    if (secretKey) {
      const payload = await verifyToken(token, { secretKey });
      if (!payload.sub) {
        throw new Error('Missing subject claim');
      }
      return payload.sub;
    }

    // ponytail: dev fallback when Clerk secret is not configured
    const devSecret =
      this.configService.get<string>('clerk.jwtSecret') ?? 'dev-secret';
    const payload = verify(token, devSecret) as { sub: string };
    return payload.sub;
  }
}
