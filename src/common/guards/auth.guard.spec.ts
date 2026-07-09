import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthService } from '../../auth/auth.service';
import { User } from '../../users/entities/user.entity';
import { AuthGuard } from './auth.guard';

interface FakeRequest {
  headers: { authorization?: string };
  user?: User;
}

function makeContext(authorization?: string): {
  ctx: ExecutionContext;
  req: FakeRequest;
} {
  const req: FakeRequest = {
    headers: authorization ? { authorization } : {},
  };
  const ctx = {
    switchToHttp: () => ({ getRequest: () => req }),
    getHandler: () => undefined,
    getClass: () => undefined,
  } as unknown as ExecutionContext;
  return { ctx, req };
}

describe('AuthGuard', () => {
  let reflector: Reflector;
  let authService: { authenticateByBearerToken: jest.Mock };
  let guard: AuthGuard;

  beforeEach(() => {
    reflector = new Reflector();
    authService = { authenticateByBearerToken: jest.fn() };
    guard = new AuthGuard(reflector, authService as unknown as AuthService);
  });

  it('skips authentication for @Public routes', async () => {
    // isPublic = true (and isOptionalAuth reads the same mock -> true, no token present)
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(true);
    const { ctx } = makeContext();
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(authService.authenticateByBearerToken).not.toHaveBeenCalled();
  });

  it('throws when no token is present on a protected route', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);
    const { ctx } = makeContext();
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('attaches the resolved user for a valid token', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);
    const user = { id: 'u1' } as User;
    authService.authenticateByBearerToken.mockResolvedValue(user);
    const { ctx, req } = makeContext('Bearer abc');

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(authService.authenticateByBearerToken).toHaveBeenCalledWith('abc');
    expect(req.user).toBe(user);
  });
});
