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

    // Dev fallback when no Clerk secrets are configured.
    const devSecret =
      this.configService.get<string>('clerk.jwtSecret') ?? 'dev-secret';
    const payload = verify(token, devSecret) as { sub: string };
    return { sub: payload.sub };
  }
}
