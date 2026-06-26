import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { User, UserType } from './entities/user.entity';
import { UsersService } from './users.service';

describe('UsersService', () => {
  let service: UsersService;
  let repository: jest.Mocked<Repository<User>>;

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

  describe('findByClerkId', () => {
    it('should return a user by clerkId', async () => {
      repository.findOne.mockResolvedValue(user);
      const result = await service.findByClerkId(user.clerkId);
      expect(result).toEqual(user);
      expect(repository.findOne).toHaveBeenCalledWith({
        where: { clerkId: user.clerkId },
      });
    });
  });

  describe('create', () => {
    const createDto: CreateUserDto = {
      clerkId: 'clerk_user_2',
      email: 'JANE@EXAMPLE.COM',
      firstName: 'Jane',
      lastName: 'Doe',
      phone: '+1234567890',
      userType: UserType.ADMIN,
    };

    it('should create a user with lowercased email', async () => {
      repository.findOne.mockResolvedValue(null);
      repository.create.mockReturnValue(user);
      repository.save.mockResolvedValue(user);

      const result = await service.create(createDto);

      expect(result).toEqual(user);
      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          clerkId: createDto.clerkId,
          email: 'jane@example.com',
        }),
      );
    });

    it('should throw ConflictException for duplicate email', async () => {
      repository.findOne.mockResolvedValue(user);
      await expect(service.create(createDto)).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('should throw ConflictException for duplicate clerkId', async () => {
      repository.findOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ ...user, clerkId: createDto.clerkId });
      await expect(service.create(createDto)).rejects.toBeInstanceOf(
        ConflictException,
      );
    });
  });

  describe('update', () => {
    it('should update a user', async () => {
      repository.findOne.mockResolvedValue({ ...user });
      repository.save.mockImplementation((u) => Promise.resolve(u as User));

      const updateDto: UpdateUserDto = { firstName: 'Janet' };

      const result = await service.update(user.id, updateDto);

      expect(result.firstName).toBe('Janet');
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

  describe('createOrUpdateFromClerk', () => {
    it('should create a new user from Clerk data', async () => {
      repository.findOne.mockResolvedValue(null);
      repository.create.mockReturnValue(user);
      repository.save.mockResolvedValue(user);

      const result = await service.createOrUpdateFromClerk('clerk_new', {
        email: 'NEW@EXAMPLE.COM',
        firstName: 'New',
        lastName: 'User',
        userType: UserType.ADMIN,
      });

      expect(result).toEqual(user);
      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          clerkId: 'clerk_new',
          email: 'new@example.com',
          firstName: 'New',
          lastName: 'User',
          userType: UserType.ADMIN,
          isActive: true,
        }),
      );
    });

    it('should update an existing user and reactivate them', async () => {
      const existing = { ...user, isActive: false };
      repository.findOne.mockResolvedValue(existing);
      repository.save.mockImplementation((u) => Promise.resolve(u as User));

      const result = await service.createOrUpdateFromClerk(user.clerkId, {
        email: 'updated@example.com',
      });

      expect(result.email).toBe('updated@example.com');
      expect(result.isActive).toBe(true);
    });

    it('should throw ConflictException for duplicate email', async () => {
      repository.findOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ ...user, id: 'other-id' });
      await expect(
        service.createOrUpdateFromClerk('clerk_new', {
          email: user.email,
        }),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('deactivateByClerkId', () => {
    it('should deactivate a user', async () => {
      repository.findOne.mockResolvedValue({ ...user });
      repository.save.mockImplementation((u) => Promise.resolve(u as User));

      await service.deactivateByClerkId(user.clerkId);

      expect(repository.save).toHaveBeenCalledWith(
        expect.objectContaining({ isActive: false }),
      );
    });

    it('should do nothing when user is not found', async () => {
      repository.findOne.mockResolvedValue(null);
      await expect(
        service.deactivateByClerkId('missing'),
      ).resolves.toBeUndefined();
      expect(repository.save).not.toHaveBeenCalled();
    });
  });
});
