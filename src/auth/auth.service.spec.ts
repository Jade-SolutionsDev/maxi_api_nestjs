import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { verify } from 'jsonwebtoken';
import * as passwordHelper from '../common/helpers/password.helper';
import { UserStatus, UserType } from '../users/entities/user.entity';
import { UsersService } from '../users/users.service';
import { AuthService } from './auth.service';

describe('AuthService', () => {
  let service: AuthService;
  let usersService: jest.Mocked<UsersService>;

  const user = {
    id: '550e8400-e29b-41d4-a716-446655440000',
    clerkUserId: null,
    firstName: 'Jane',
    lastName: 'Doe',
    email: 'jane@example.com',
    phone: null,
    userType: UserType.ADMIN,
    status: UserStatus.ACTIVE,
    passwordHash: 'hashed',
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
            findByEmail: jest.fn(),
          },
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              if (key === 'jwt.secret') return 'test-secret';
              if (key === 'jwt.expiresIn') return '1h';
              return undefined;
            }),
          },
        },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    usersService = module.get(UsersService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should return an access token and sanitized user on valid credentials', async () => {
    usersService.findByEmail.mockResolvedValue(user);
    jest.spyOn(passwordHelper, 'comparePassword').mockResolvedValue(true);

    const result = await service.login({
      email: user.email,
      password: 'SecurePass1',
    });

    expect(result.accessToken).toBeDefined();
    expect(result.user.email).toBe(user.email);
    expect(result.user).not.toHaveProperty('passwordHash');

    const decoded = verify(result.accessToken, 'test-secret') as {
      sub: string;
      email: string;
      userType: string;
      status: string;
    };
    expect(decoded.sub).toBe(user.id);
    expect(decoded.email).toBe(user.email);
    expect(decoded.userType).toBe(user.userType);
    expect(decoded.status).toBe(user.status);
  });

  it('should throw UnauthorizedException when email is unknown', async () => {
    usersService.findByEmail.mockResolvedValue(null);

    await expect(
      service.login({ email: 'missing@example.com', password: 'any' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('should throw UnauthorizedException when password is invalid', async () => {
    usersService.findByEmail.mockResolvedValue(user);
    jest.spyOn(passwordHelper, 'comparePassword').mockResolvedValue(false);

    await expect(
      service.login({ email: user.email, password: 'WrongPassword' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
