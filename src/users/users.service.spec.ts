import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { Invitation } from './entities/invitation.entity';
import { Role, User } from './entities/user.entity';
import { UsersService } from './users.service';

describe('UsersService', () => {
  let service: UsersService;
  let repository: jest.Mocked<Repository<User>>;
  let invitationRepository: jest.Mocked<Repository<Invitation>>;
  let qb: {
    withDeleted: jest.Mock;
    andWhere: jest.Mock;
    orderBy: jest.Mock;
    addOrderBy: jest.Mock;
    skip: jest.Mock;
    take: jest.Mock;
    getManyAndCount: jest.Mock;
  };

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
    qb = {
      withDeleted: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getManyAndCount: jest.fn(),
    };

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
            update: jest.fn(),
            softDelete: jest.fn(),
            restore: jest.fn(),
            count: jest.fn(),
            createQueryBuilder: jest.fn().mockReturnValue(qb),
          },
        },
        {
          provide: getRepositoryToken(Invitation),
          useValue: {
            find: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
    repository = module.get(getRepositoryToken(User));
    invitationRepository = module.get(getRepositoryToken(Invitation));
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('findAll', () => {
    it('should return a paginated envelope', async () => {
      qb.getManyAndCount.mockResolvedValue([[user], 1]);
      const result = await service.findAll();
      expect(result.data).toEqual([user]);
      expect(result.meta).toEqual({
        total: 1,
        page: 1,
        limit: 20,
        totalPages: 1,
      });
    });

    it('should include pending invitations pinned to page 1 and counted in total', async () => {
      qb.getManyAndCount.mockResolvedValue([[user], 1]);
      invitationRepository.find.mockResolvedValue([
        {
          id: 'inv-1',
          email: 'pending@example.com',
          role: Role.KARDIST,
          organizationId: null,
          invitedById: null,
          firstName: null,
          lastName: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        } as Invitation,
      ]);

      const result = await service.findAll({ includeInvitations: true });

      expect(result.meta.total).toBe(2);
      expect(result.data).toHaveLength(2);
      expect(result.data[0].email).toBe('pending@example.com');
      expect(result.data[0].isActive).toBe(false);
    });

    it('should NOT append pending invitations when a status facet is set', async () => {
      qb.getManyAndCount.mockResolvedValue([[user], 1]);
      const result = await service.findAll({
        status: 'active',
        includeInvitations: true,
      });
      expect(invitationRepository.find).not.toHaveBeenCalled();
      expect(result.data).toEqual([user]);
      expect(qb.andWhere).toHaveBeenCalledWith('user.isActive = true');
    });

    it('should return only pending invitations for status=pending', async () => {
      invitationRepository.find.mockResolvedValue([
        {
          id: 'inv-1',
          email: 'p@example.com',
          role: Role.GROCER,
        } as Invitation,
      ]);
      const result = await service.findAll({ status: 'pending' });
      expect(qb.getManyAndCount).not.toHaveBeenCalled();
      expect(result.data).toHaveLength(1);
      expect(result.meta.total).toBe(1);
    });

    it('should include soft-deleted users when includeDeleted is set', async () => {
      qb.getManyAndCount.mockResolvedValue([[user], 1]);
      await service.findAll({ includeDeleted: true });
      expect(qb.withDeleted).toHaveBeenCalled();
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

  describe('create', () => {
    const createDto: CreateUserDto = {
      clerkId: 'clerk_user_2',
      email: 'JANE@EXAMPLE.COM',
      firstName: 'Jane',
      lastName: 'Doe',
      phone: '+1234567890',
      role: Role.ADMIN,
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
  });

  describe('update', () => {
    it('should update a user', async () => {
      repository.findOne.mockResolvedValue({ ...user });
      repository.save.mockImplementation((u) => Promise.resolve(u as User));

      const updateDto: UpdateUserDto = { firstName: 'Janet' };
      const result = await service.update(user.id, updateDto);

      expect(result.firstName).toBe('Janet');
    });

    it('should preserve unset fields on a partial update (no name clobber)', async () => {
      repository.findOne.mockResolvedValue({ ...user });
      repository.save.mockImplementation((u) => Promise.resolve(u as User));

      // Validated PATCH DTOs carry unset optional fields as own `undefined`.
      const updateDto = {
        isActive: false,
        firstName: undefined,
        lastName: undefined,
      } as UpdateUserDto;
      const result = await service.update(user.id, updateDto);

      expect(result.isActive).toBe(false);
      expect(result.firstName).toBe(user.firstName);
      expect(result.lastName).toBe(user.lastName);
    });

    it('should throw ConflictException when changing email to an existing one', async () => {
      repository.findOne
        .mockResolvedValueOnce({ ...user })
        .mockResolvedValueOnce({ ...user, id: 'other-id' });

      await expect(
        service.update(user.id, { email: 'taken@example.com' }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('should forbid changing your own role', async () => {
      const self = { ...user };
      repository.findOne.mockResolvedValue({ ...self });
      await expect(
        service.update(self.id, { role: Role.KARDIST }, self),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('should forbid deactivating your own account', async () => {
      const self = { ...user };
      repository.findOne.mockResolvedValue({ ...self });
      await expect(
        service.update(self.id, { isActive: false }, self),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('should forbid demoting the last active super admin', async () => {
      const superAdmin = { ...user, id: 'sa-1', role: Role.SUPER_ADMIN };
      repository.findOne.mockResolvedValue({ ...superAdmin });
      repository.count.mockResolvedValue(1);
      await expect(
        service.update('sa-1', { role: Role.ADMIN }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('should allow demoting a super admin when others remain', async () => {
      const superAdmin = { ...user, id: 'sa-1', role: Role.SUPER_ADMIN };
      repository.findOne.mockResolvedValue({ ...superAdmin });
      repository.count.mockResolvedValue(2);
      repository.save.mockImplementation((u) => Promise.resolve(u as User));
      const result = await service.update('sa-1', { role: Role.ADMIN });
      expect(result.role).toBe(Role.ADMIN);
    });
  });

  describe('remove', () => {
    it('should soft delete and deactivate a user', async () => {
      repository.findOne.mockResolvedValue({ ...user });
      repository.update.mockResolvedValue({} as never);
      repository.softDelete.mockResolvedValue({
        affected: 1,
        raw: [],
        generatedMaps: [],
      });
      await service.remove(user.id);
      expect(repository.update).toHaveBeenCalledWith(user.id, {
        isActive: false,
      });
      expect(repository.softDelete).toHaveBeenCalledWith(user.id);
    });

    it('should throw NotFoundException when user does not exist', async () => {
      repository.findOne.mockResolvedValue(null);
      await expect(service.remove(user.id)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('should forbid deleting your own account', async () => {
      const self = { ...user };
      repository.findOne.mockResolvedValue({ ...self });
      await expect(service.remove(self.id, self)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('should forbid deleting the last active super admin', async () => {
      const superAdmin = { ...user, id: 'sa-1', role: Role.SUPER_ADMIN };
      repository.findOne.mockResolvedValue({ ...superAdmin });
      repository.count.mockResolvedValue(1);
      await expect(service.remove('sa-1')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });
  });

  describe('restore', () => {
    it('should restore a soft-deleted user', async () => {
      const deleted = {
        ...user,
        deletedAt: new Date(),
        email: null,
        clerkId: null,
      };
      repository.findOne.mockResolvedValueOnce(deleted); // withDeleted lookup
      repository.restore.mockResolvedValue({} as never);
      repository.update.mockResolvedValue({} as never);
      repository.findOne.mockResolvedValueOnce({ ...user }); // final findOne

      const result = await service.restore(user.id);

      expect(repository.restore).toHaveBeenCalledWith(user.id);
      expect(repository.update).toHaveBeenCalledWith(user.id, {
        isActive: true,
      });
      expect(result.id).toBe(user.id);
    });

    it('should reject restore when an active email clash exists (dedupe)', async () => {
      const deleted = { ...user, deletedAt: new Date() };
      repository.findOne
        .mockResolvedValueOnce(deleted) // withDeleted lookup
        .mockResolvedValueOnce({ ...user, id: 'clash-id' }); // email clash
      await expect(service.restore(user.id)).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('should throw NotFoundException when the user does not exist', async () => {
      repository.findOne.mockResolvedValue(null);
      await expect(service.restore('missing')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('createOrUpdateFromClerk', () => {
    it('should create a new user defaulting to KARDIST', async () => {
      repository.findOne.mockResolvedValue(null);
      repository.create.mockReturnValue(user);
      repository.save.mockResolvedValue(user);

      await service.createOrUpdateFromClerk('clerk_new', {
        email: 'NEW@EXAMPLE.COM',
        firstName: 'New',
        lastName: 'User',
      });

      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          clerkId: 'clerk_new',
          email: 'new@example.com',
          role: Role.KARDIST,
          isActive: true,
        }),
      );
    });

    it('should update an existing user and reactivate them', async () => {
      const existing = { ...user, isActive: false };
      repository.findOne.mockResolvedValue(existing);
      repository.save.mockImplementation((u) => Promise.resolve(u as User));

      const result = await service.createOrUpdateFromClerk(user.clerkId!, {
        email: 'updated@example.com',
      });

      expect(result.email).toBe('updated@example.com');
      expect(result.isActive).toBe(true);
    });
  });

  describe('deactivateByClerkId', () => {
    it('should deactivate a user', async () => {
      repository.findOne.mockResolvedValue({ ...user });
      repository.save.mockImplementation((u) => Promise.resolve(u as User));

      await service.deactivateByClerkId(user.clerkId!);

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
