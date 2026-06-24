import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { sign } from 'jsonwebtoken';
import { User, UserType } from '../users/entities/user.entity';
import { UsersService } from '../users/users.service';
import { AuthService } from './auth.service';

describe('AuthService', () => {
  let service: AuthService;
  let usersService: jest.Mocked<UsersService>;

  const user: User = {
    id: '550e8400-e29b-41d4-a716-446655440000',
    clerkId: 'clerk_user_1',
    userType: UserType.ADMIN,
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
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              if (key === 'clerk.secretKey') return undefined;
              if (key === 'clerk.jwtSecret') return 'dev-secret';
              return undefined;
            }),
          },
        },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    usersService = module.get(UsersService);
  });

  it('should authenticate a user with a valid dev token', async () => {
    usersService.findByClerkId.mockResolvedValue(user);

    const token = sign({ sub: user.clerkId }, 'dev-secret');
    const result = await service.authenticateByBearerToken(token);

    expect(result.id).toBe(user.id);
    expect(usersService.findByClerkId).toHaveBeenCalledWith(user.clerkId);
  });

  it('should reject an invalid token', async () => {
    await expect(
      service.authenticateByBearerToken('invalid-token'),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('should reject when user is not found', async () => {
    usersService.findByClerkId.mockResolvedValue(null);

    const token = sign({ sub: 'unknown' }, 'dev-secret');
    await expect(
      service.authenticateByBearerToken(token),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('should reject when user is inactive', async () => {
    usersService.findByClerkId.mockResolvedValue({ ...user, isActive: false });

    const token = sign({ sub: user.clerkId }, 'dev-secret');
    await expect(
      service.authenticateByBearerToken(token),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('should return current user via me', async () => {
    usersService.findByClerkId.mockResolvedValue(user);

    const result = await service.me(user.clerkId);

    expect(result.id).toBe(user.id);
  });
});
