import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthenticatedUserRequest } from '../../auth/types/authenticated-request';
import { ANY_AUTHENTICATED_KEY } from '../../common/decorators/any-authenticated.decorator';
import {
  IS_PUBLIC_KEY,
  ROLES_KEY,
} from '../../common/constants/auth.constants';
import { Role } from '../../users/entities/user.entity';
import {
  PERMISSION_KEY,
  PermissionRequirement,
} from '../decorators/require-permission.decorator';
import { isSystemAdmin, PermissionsService } from '../permissions.service';

/**
 * DEFAULT-DENY permission gate (last in the global chain, after AuthGuard and
 * RolesGuard):
 *
 *   @Public()               → allow (storefront / webhooks / health)
 *   no request.user         → 403
 *   ADMIN / SUPER_ADMIN     → allow (system admins bypass all permissions)
 *   @RequirePermission(...) → check the user's assigned-role grants
 *   @Roles(...) present     → allow (RolesGuard already enforced the enum gate
 *                             — the hard admin-only surfaces: users, permissions)
 *   @AnyAuthenticated()     → allow (ONLY the /auth/me session bootstrap)
 *   otherwise               → 403
 *
 * The last branch is the point: a backoffice route that forgets its
 * @RequirePermission is invisible to every non-admin. New modules MUST register
 * in MODULE_ACTIONS and decorate their routes — see the workspace CLAUDE.md.
 */
@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly permissionsService: PermissionsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];

    const isPublic = this.reflector.getAllAndOverride<boolean>(
      IS_PUBLIC_KEY,
      targets,
    );
    if (isPublic) return true;

    const request = context
      .switchToHttp()
      .getRequest<AuthenticatedUserRequest>();
    if (!request.user) {
      throw new ForbiddenException('Authentication required');
    }

    if (isSystemAdmin(request.user.role)) return true;

    const requirement = this.reflector.getAllAndOverride<PermissionRequirement>(
      PERMISSION_KEY,
      targets,
    );
    if (requirement) {
      const allowed = await this.permissionsService.hasPermission(
        request.user.id,
        request.user.role,
        requirement.module,
        requirement.action,
      );
      if (!allowed) {
        throw new ForbiddenException('Permission denied');
      }
      return true;
    }

    // Explicitly enum-gated route (users/permissions surfaces): RolesGuard
    // already validated the caller's role, nothing more to check here.
    const roles = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, targets);
    if (roles && roles.length > 0) return true;

    if (
      this.reflector.getAllAndOverride<boolean>(ANY_AUTHENTICATED_KEY, targets)
    ) {
      return true;
    }

    // Default-deny: an undecorated backoffice route does not exist for
    // non-admins.
    throw new ForbiddenException('Permission denied');
  }
}
