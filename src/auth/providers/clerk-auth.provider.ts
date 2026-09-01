import { isLocalEnv } from '../../config/configuration';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { verifyToken } from '@clerk/backend';
import { verify } from 'jsonwebtoken';
import {
  AuthProvider,
  VerifiedToken,
} from '../interfaces/auth-provider.interface';

/**
 * Real authentication backend. Providers/staff/customers live in the storefront
 * Clerk instance; admins live in a separate backoffice Clerk instance. We try
 * both before falling back to a dev JWT (only when no Clerk secret is set).
 */
@Injectable()
export class ClerkAuthProvider extends AuthProvider {
  private readonly logger = new Logger(ClerkAuthProvider.name);

  constructor(private readonly configService: ConfigService) {
    super();
  }

  async verifyToken(token: string): Promise<VerifiedToken> {
    const secretKey = this.configService.get<string>('clerk.secretKey');
    const backofficeSecretKey = this.configService.get<string>(
      'clerk.backofficeSecretKey',
    );

    try {
      if (secretKey) {
        const payload = await verifyToken(token, { secretKey });
        if (payload.sub) {
          return { sub: payload.sub };
        }
      }
    } catch (error) {
      this.logger.warn(
        `Failed to verify token against storefront Clerk instance: ${error}`,
      );
    }

    try {
      if (backofficeSecretKey) {
        const payload = await verifyToken(token, {
          secretKey: backofficeSecretKey,
        });
        if (payload.sub) {
          return { sub: payload.sub };
        }
      }
    } catch (error) {
      this.logger.warn(
        `Failed to verify token against backoffice Clerk instance: ${error}`,
      );
    }

    if (secretKey || backofficeSecretKey) {
      throw new Error('Unable to verify Clerk token against known instances');
    }

    /**
     * Dev fallback when no Clerk secrets are configured — local only.
     *
     * Without the interlock, forgetting both Clerk keys in a deployed
     * environment did not break authentication: it opened it. Any token signed
     * with `dev-secret` — a literal in this repository — would be accepted as
     * a valid user. A missing variable must never widen access.
     */
    if (!isLocalEnv()) {
      throw new Error(
        'Clerk no está configurado en un entorno desplegado: falta CLERK_SECRET_KEY o CLERK_BACKOFFICE_SECRET_KEY',
      );
    }

    const devSecret =
      this.configService.get<string>('clerk.jwtSecret') ?? 'dev-secret';
    const payload = verify(token, devSecret) as { sub: string };
    return { sub: payload.sub };
  }
}
