import { SetMetadata } from '@nestjs/common';

export const ANY_AUTHENTICATED_KEY = 'anyAuthenticated';

/**
 * Escape hatch from the default-deny {@link PermissionGuard}: the route is
 * reachable by ANY authenticated backoffice user, regardless of roles or
 * permissions. Reserved for identity bootstrap (`GET /auth/me`) — future
 * system roles must be able to load their session without any grant. Do NOT
 * use it on business routes; those take @RequirePermission (grantable) or
 * @Roles (hard admin-only).
 */
export const AnyAuthenticated = () => SetMetadata(ANY_AUTHENTICATED_KEY, true);
