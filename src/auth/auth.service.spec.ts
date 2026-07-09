import { UnauthorizedException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Role, User } from '../users/entities/user.entity';
import { UsersService } from '../users/users.service';
import { AuthService } from './auth.service';
import {
  AUTH_PROVIDER,
  AuthProvider,
} from './interfaces/auth-provider.interface';

describe('AuthService', () => {
  let service: AuthService;
  let usersService: jest.Mocked<UsersService>;
  let authProvider: jest.Mocked<AuthProvider>;

  const user: User = {
    id: '550e8400-e29b-41d4-a716-446655440000',
    clerkId: 'clerk_user_1',
    role: Role.ADMIN,
    email: 'jane@example.com',
    firstName: 'Jane',
    lastName: 'Doe',
    phone: null,
    avatarUrl: null,
    businessName: null,
    businessDescription: null,
    businessLogoUrl: null,
    clerkOrgId: null,
    isActive: true,
    createdBy: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: UsersService,
          useValue: {
            findByClerkId: jest.fn(),
          },
        },
        {
          provide: AUTH_PROVIDER,
          useValue: {
            verifyToken: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    usersService = module.get(UsersService);
    authProvider = module.get(AUTH_PROVIDER);
  });

  it('should authenticate a user with a valid token', async () => {
    authProvider.verifyToken.mockResolvedValue({ sub: user.clerkId! });
    usersService.findByClerkId.mockResolvedValue(user);

    const result = await service.authenticateByBearerToken('good-token');

    expect(result.id).toBe(user.id);
    expect(authProvider.verifyToken).toHaveBeenCalledWith('good-token');
    expect(usersService.findByClerkId).toHaveBeenCalledWith(user.clerkId);
  });

  it('should reject an invalid token', async () => {
    authProvider.verifyToken.mockRejectedValue(new Error('bad token'));

    await expect(
      service.authenticateByBearerToken('invalid-token'),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('should reject when user is not found', async () => {
    authProvider.verifyToken.mockResolvedValue({ sub: 'unknown' });
    usersService.findByClerkId.mockResolvedValue(null);

    await expect(
      service.authenticateByBearerToken('good-token'),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('should reject when user is inactive', async () => {
    authProvider.verifyToken.mockResolvedValue({ sub: user.clerkId! });
    usersService.findByClerkId.mockResolvedValue({ ...user, isActive: false });

    await expect(
      service.authenticateByBearerToken('good-token'),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('should return current user via me', async () => {
    usersService.findByClerkId.mockResolvedValue(user);

    const result = await service.me(user.clerkId!);

    expect(result.id).toBe(user.id);
  });
});
