import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ANY_AUTHENTICATED_KEY } from '../../common/decorators/any-authenticated.decorator';
import {
  IS_PUBLIC_KEY,
  ROLES_KEY,
} from '../../common/constants/auth.constants';
import { Role } from '../../users/entities/user.entity';
import { PERMISSION_KEY } from '../decorators/require-permission.decorator';
import { PermissionsService } from '../permissions.service';
import { PermissionGuard } from './permission.guard';

describe('PermissionGuard (default-deny)', () => {
  let guard: PermissionGuard;
  let reflector: { getAllAndOverride: jest.Mock };
  let permissionsService: { hasPermission: jest.Mock };
  // What the reflector answers per metadata key for the current "route".
  let metadata: Record<string, unknown>;

  const buildContext = (user?: { id: string; role: Role }): ExecutionContext =>
    ({
      getHandler: () => ({}),
      getClass: () => ({}),
      switchToHttp: () => ({ getRequest: () => ({ user }) }),
    }) as unknown as ExecutionContext;

  beforeEach(() => {
    metadata = {};
    reflector = {
      getAllAndOverride: jest.fn((key: string) => metadata[key]),
    };
    permissionsService = { hasPermission: jest.fn() };
    guard = new PermissionGuard(
      reflector as unknown as Reflector,
      permissionsService as unknown as PermissionsService,
    );
  });

  it('allows @Public routes without touching the request', async () => {
    metadata[IS_PUBLIC_KEY] = true;
    await expect(guard.canActivate(buildContext())).resolves.toBe(true);
  });

  it('rejects when there is no authenticated user', async () => {
    await expect(guard.canActivate(buildContext())).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('lets system admins through undecorated routes', async () => {
    await expect(
      guard.canActivate(buildContext({ id: 'u1', role: Role.ADMIN })),
    ).resolves.toBe(true);
    await expect(
      guard.canActivate(buildContext({ id: 'u1', role: Role.SUPER_ADMIN })),
    ).resolves.toBe(true);
    expect(permissionsService.hasPermission).not.toHaveBeenCalled();
  });

  it('DENIES a non-admin on an undecorated route — the default-deny flip', async () => {
    await expect(
      guard.canActivate(buildContext({ id: 'u1', role: Role.GROCER })),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('delegates @RequirePermission to the grants check (allow)', async () => {
    metadata[PERMISSION_KEY] = { module: 'products', action: 'update' };
    permissionsService.hasPermission.mockResolvedValue(true);

    await expect(
      guard.canActivate(buildContext({ id: 'u1', role: Role.KARDIST })),
    ).resolves.toBe(true);
    expect(permissionsService.hasPermission).toHaveBeenCalledWith(
      'u1',
      Role.KARDIST,
      'products',
      'update',
    );
  });

  it('delegates @RequirePermission to the grants check (deny)', async () => {
    metadata[PERMISSION_KEY] = { module: 'products', action: 'update' };
    permissionsService.hasPermission.mockResolvedValue(false);

    await expect(
      guard.canActivate(buildContext({ id: 'u1', role: Role.KARDIST })),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('passes @Roles-gated routes (RolesGuard already enforced the enum)', async () => {
    metadata[ROLES_KEY] = [Role.SUPER_ADMIN, Role.ADMIN];
    await expect(
      guard.canActivate(buildContext({ id: 'u1', role: Role.GROCER })),
    ).resolves.toBe(true);
    expect(permissionsService.hasPermission).not.toHaveBeenCalled();
  });

  it('passes @AnyAuthenticated routes (the /auth/me bootstrap)', async () => {
    metadata[ANY_AUTHENTICATED_KEY] = true;
    await expect(
      guard.canActivate(buildContext({ id: 'u1', role: Role.KARDIST })),
    ).resolves.toBe(true);
  });
});
