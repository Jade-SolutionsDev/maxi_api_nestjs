import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthService } from '../../auth/auth.service';
import { AuthenticatedUserRequest } from '../../auth/types/authenticated-request';
import { IS_PUBLIC_KEY } from '../constants/auth.constants';
import { IS_OPTIONAL_AUTH_KEY } from '../decorators/optional-auth.decorator';

/**
 * Global authentication guard for backoffice routes. Resolves the Bearer token
 * to the authoritative {@link User} entity (via {@link AuthService}, which
 * verifies the token and loads the DB record) and attaches it as `request.user`.
 *
 * Routes marked `@Public()` are skipped; if also `@OptionalAuth()`, a valid
 * token is still resolved best-effort. Storefront (client) routes should be
 * `@Public()` and use the explicit `ClerkClientAuthGuard` instead.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly authService: AuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    const request = context
      .switchToHttp()
      .getRequest<AuthenticatedUserRequest>();

    if (isPublic) {
      const isOptionalAuth = this.reflector.getAllAndOverride<boolean>(
        IS_OPTIONAL_AUTH_KEY,
        [context.getHandler(), context.getClass()],
      );
      if (isOptionalAuth) {
        await this.attachUserIfPossible(request);
      }
      return true;
    }

    const token = this.extractToken(request.headers.authorization);
    if (!token) {
      throw new UnauthorizedException('Missing access token');
    }

    request.user = await this.authService.authenticateByBearerToken(token);
    return true;
  }

  private async attachUserIfPossible(
    request: AuthenticatedUserRequest,
  ): Promise<void> {
    const token = this.extractToken(request.headers.authorization);
    if (!token) {
      return;
    }
    try {
      request.user = await this.authService.authenticateByBearerToken(token);
    } catch {
      // Optional auth: invalid/expired tokens are ignored on public routes.
    }
  }

  private extractToken(header?: string): string | undefined {
    const [type, token] = header?.split(' ') ?? [];
    return type === 'Bearer' ? token : undefined;
  }
}
