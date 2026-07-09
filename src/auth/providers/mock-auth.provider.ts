import { Injectable, UnauthorizedException } from '@nestjs/common';
import {
  AuthProvider,
  VerifiedToken,
} from '../interfaces/auth-provider.interface';

/**
 * Deterministic auth backend for local dev and e2e tests, selected when
 * `MOCK_AUTH_ENABLED=true`. Accepts tokens shaped `mock:<clerkId>` (or
 * `mock-<clerkId>`) and returns that clerkId as the subject, so tests can seed a
 * `User` with a known clerkId and authenticate as it without any Clerk secret.
 */
@Injectable()
export class MockAuthProvider extends AuthProvider {
  verifyToken(token: string): Promise<VerifiedToken> {
    const match = /^mock[:-](?<sub>.+)$/.exec(token ?? '');
    const sub = match?.groups?.sub?.trim();
    if (!sub) {
      throw new UnauthorizedException('Invalid mock token');
    }
    return Promise.resolve({ sub });
  }
}
