import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as passwordHelper from '../common/helpers/password.helper';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { User, UserStatus, UserType } from './entities/user.entity';
import { UsersService } from './users.service';

describe('UsersService', () => {
  let service: UsersService;
  let repository: jest.Mocked<Repository<User>>;

  const user: User = {
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
        UsersService,
        {
          provide: getRepositoryToken(User),
          useValue: {
            find: jest.fn(),
            findOne: jest.fn(),
            create: jest.fn(),
            save: jest.fn(),
            softDelete: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
    repository = module.get(getRepositoryToken(User));
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('findAll', () => {
    it('should return all users', async () => {
      repository.find.mockResolvedValue([user]);
      const result = await service.findAll();
      expect(result).toEqual([user]);
    });
  });

  describe('findOne', () => {
    it('should return a user by id', async () => {
      repository.findOne.mockResolvedValue(user);
      const result = await service.findOne(user.id);
      expect(result).toEqual(user);
    });

    it('should throw NotFoundException when user is missing', async () => {
      repository.findOne.mockResolvedValue(null);
      await expect(service.findOne(user.id)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('findByEmail', () => {
    it('should return a user by email', async () => {
      repository.findOne.mockResolvedValue(user);
      const result = await service.findByEmail(user.email);
      expect(result).toEqual(user);
      expect(repository.findOne).toHaveBeenCalledWith({
        where: { email: user.email },
      });
    });
  });

  describe('create', () => {
    const createDto: CreateUserDto = {
      firstName: 'Jane',
      lastName: 'Doe',
      email: 'JANE@EXAMPLE.COM',
      phone: '+1234567890',
      userType: UserType.ADMIN,
      status: UserStatus.ACTIVE,
      password: 'SecurePass1',
    };

    it('should create a user with a hashed password and lowercased email', async () => {
      repository.findOne.mockResolvedValue(null);
      repository.create.mockReturnValue(user);
      repository.save.mockResolvedValue(user);
      jest.spyOn(passwordHelper, 'hashPassword').mockResolvedValue('hashed');

      const result = await service.create(createDto);

      expect(result).toEqual(user);
      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          email: 'jane@example.com',
          passwordHash: 'hashed',
        }),
      );
    });

    it('should throw ConflictException for duplicate email', async () => {
      repository.findOne.mockResolvedValue(user);
      await expect(service.create(createDto)).rejects.toBeInstanceOf(
        ConflictException,
      );
    });
  });

  describe('update', () => {
    it('should update a user and hash a new password', async () => {
      repository.findOne.mockResolvedValue({ ...user });
      repository.save.mockImplementation((u) => Promise.resolve(u as User));
      jest.spyOn(passwordHelper, 'hashPassword').mockResolvedValue('new-hash');

      const updateDto: UpdateUserDto = {
        firstName: 'Janet',
        password: 'NewSecure1',
      };

      const result = await service.update(user.id, updateDto);

      expect(result.firstName).toBe('Janet');
      expect(result.passwordHash).toBe('new-hash');
    });

    it('should throw ConflictException when changing email to an existing one', async () => {
      repository.findOne
        .mockResolvedValueOnce({ ...user })
        .mockResolvedValueOnce({ ...user, id: 'other-id' });

      await expect(
        service.update(user.id, { email: 'taken@example.com' }),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('remove', () => {
    it('should soft delete a user', async () => {
      repository.softDelete.mockResolvedValue({
        affected: 1,
        raw: [],
        generatedMaps: [],
      });
      await service.remove(user.id);
      expect(repository.softDelete).toHaveBeenCalledWith(user.id);
    });

    it('should throw NotFoundException when user does not exist', async () => {
      repository.softDelete.mockResolvedValue({
        affected: 0,
        raw: [],
        generatedMaps: [],
      });
      await expect(service.remove(user.id)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });
});
