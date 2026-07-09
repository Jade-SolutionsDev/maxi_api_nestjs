import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthenticatedUserRequest } from '../../auth/types/authenticated-request';
import { Role } from '../../users/entities/user.entity';
import { ROLES_KEY } from '../constants/auth.constants';

/**
 * Global role guard. Reads the `@Roles(...)` metadata and checks it against the
 * role on the DB-loaded `request.user` (populated by {@link AuthGuard}, which
 * runs first). Routes with no `@Roles()` decorator allow any authenticated user.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const request = context
      .switchToHttp()
      .getRequest<AuthenticatedUserRequest>();
    const user = request.user;

    if (!user || !requiredRoles.includes(user.role)) {
      throw new ForbiddenException('Insufficient role');
    }

    return true;
  }
}
