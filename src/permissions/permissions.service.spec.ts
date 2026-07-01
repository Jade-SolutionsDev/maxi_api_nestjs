import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User, UserType } from '../users/entities/user.entity';
import { Permission } from './entities/permission.entity';
import { RolePermission } from './entities/role-permission.entity';
import { Role } from './entities/role.entity';
import { UserRole } from './entities/user-role.entity';
import { PermissionsService } from './permissions.service';

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: 'user-1',
    clerkId: 'clerk_1',
    userType: UserType.PROVIDER,
    email: 'user@example.com',
    firstName: null,
    lastName: null,
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
    ...overrides,
  };
}

describe('PermissionsService', () => {
  let service: PermissionsService;
  let permissionRepository: jest.Mocked<Repository<Permission>>;
  let roleRepository: jest.Mocked<Repository<Role>>;
  let rolePermissionRepository: jest.Mocked<Repository<RolePermission>>;
  let userRoleRepository: jest.Mocked<Repository<UserRole>>;
  let userRepository: jest.Mocked<Repository<User>>;

  const role: Role = {
    id: 'role-1',
    name: 'Test Role',
    description: null,
    isSystem: false,
    isActive: true,
    createdBy: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
  };

  const permission: Permission = {
    id: 'perm-1',
    module: 'products',
    action: 'read',
    description: null,
    isActive: true,
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PermissionsService,
        {
          provide: getRepositoryToken(Permission),
          useValue: {
            find: jest.fn(),
            findOne: jest.fn(),
            save: jest.fn(),
            count: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(Role),
          useValue: {
            find: jest.fn(),
            findOne: jest.fn(),
            save: jest.fn(),
            softDelete: jest.fn(),
            count: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(RolePermission),
          useValue: {
            find: jest.fn(),
            findOne: jest.fn(),
            save: jest.fn(),
            delete: jest.fn(),
            count: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(UserRole),
          useValue: {
            find: jest.fn(),
            findOne: jest.fn(),
            save: jest.fn(),
            delete: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(User),
          useValue: {
            find: jest.fn(),
            findOne: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<PermissionsService>(PermissionsService);
    permissionRepository = module.get(getRepositoryToken(Permission));
    roleRepository = module.get(getRepositoryToken(Role));
    rolePermissionRepository = module.get(getRepositoryToken(RolePermission));
    userRoleRepository = module.get(getRepositoryToken(UserRole));
    userRepository = module.get(getRepositoryToken(User));
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('hasPermission', () => {
    it('should allow admins regardless of roles', async () => {
      const result = await service.hasPermission(
        'user-1',
        'admin',
        'products',
        'delete',
      );
      expect(result).toBe(true);
    });

    it('should check role permissions for non-admins', async () => {
      permissionRepository.findOne.mockResolvedValue(permission);
      userRoleRepository.find.mockResolvedValue([
        {
          userId: 'user-1',
          roleId: 'role-1',
          assignedBy: null,
          assignedAt: new Date(),
          role,
        },
      ]);
      rolePermissionRepository.count.mockResolvedValue(1);

      const result = await service.hasPermission(
        'user-1',
        'provider',
        'products',
        'read',
      );

      expect(result).toBe(true);
    });

    it('should deny when permission is missing', async () => {
      permissionRepository.findOne.mockResolvedValue(null);

      const result = await service.hasPermission(
        'user-1',
        'provider',
        'products',
        'read',
      );

      expect(result).toBe(false);
    });
  });

  describe('getUserPermissions', () => {
    it('should return all permissions for an admin user', async () => {
      userRepository.findOne.mockResolvedValue(
        makeUser({ userType: UserType.ADMIN }),
      );
      const result = await service.getUserPermissions('user-1');
      expect(result.user.userType).toBe('admin');
      expect(result.permissions.products).toContain('read');
      expect(result.permissions.orders).toContain('create');
    });

    it('should return only role-granted permissions for a non-admin', async () => {
      userRepository.findOne.mockResolvedValue(
        makeUser({ userType: UserType.PROVIDER }),
      );
      userRoleRepository.find.mockResolvedValue([
        {
          userId: 'user-1',
          roleId: 'role-1',
          assignedBy: null,
          assignedAt: new Date(),
          role,
        },
      ]);
      rolePermissionRepository.find.mockResolvedValue([
        { roleId: 'role-1', permissionId: 'perm-1', permission } as never,
      ]);

      const result = await service.getUserPermissions('user-1');

      expect(result.user.userType).toBe('provider');
      expect(result.permissions.products).toEqual(['read']);
      expect(result.permissions.orders).toBeUndefined();
    });

    it('should return no permissions for an unknown user', async () => {
      userRepository.findOne.mockResolvedValue(null);
      userRoleRepository.find.mockResolvedValue([]);

      const result = await service.getUserPermissions('ghost');

      expect(result.user.userType).toBeNull();
      expect(result.permissions).toEqual({});
    });
  });

  describe('updateRole', () => {
    it('should reject modifying a system role', async () => {
      roleRepository.findOne.mockResolvedValue({ ...role, isSystem: true });
      await expect(
        service.updateRole('role-1', { name: 'x' }),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('getRolePermissionIds', () => {
    it('should return the permission ids assigned to a role', async () => {
      rolePermissionRepository.find.mockResolvedValue([
        { roleId: 'role-1', permissionId: 'perm-1' } as RolePermission,
        { roleId: 'role-1', permissionId: 'perm-2' } as RolePermission,
      ]);
      const result = await service.getRolePermissionIds('role-1');
      expect(result).toEqual(['perm-1', 'perm-2']);
    });
  });

  describe('setUserRoles', () => {
    it('should replace a user roles with the provided set', async () => {
      roleRepository.count.mockResolvedValue(2);
      userRoleRepository.delete.mockResolvedValue({ affected: 1, raw: [] });

      await service.setUserRoles('user-1', ['role-1', 'role-2'], 'admin-1');

      expect(userRoleRepository.delete).toHaveBeenCalledWith({
        userId: 'user-1',
      });
      expect(userRoleRepository.save).toHaveBeenCalledWith([
        { userId: 'user-1', roleId: 'role-1', assignedBy: 'admin-1' },
        { userId: 'user-1', roleId: 'role-2', assignedBy: 'admin-1' },
      ]);
    });

    it('should throw when a role does not exist', async () => {
      roleRepository.count.mockResolvedValue(1);
      await expect(
        service.setUserRoles('user-1', ['role-1', 'missing'], 'admin-1'),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(userRoleRepository.delete).not.toHaveBeenCalled();
    });

    it('should clear all roles when given an empty list', async () => {
      userRoleRepository.delete.mockResolvedValue({ affected: 2, raw: [] });
      await service.setUserRoles('user-1', [], 'admin-1');
      expect(userRoleRepository.delete).toHaveBeenCalledWith({
        userId: 'user-1',
      });
      expect(userRoleRepository.save).not.toHaveBeenCalled();
    });
  });

  describe('assignPermissionToRole', () => {
    it('should assign a permission to a role', async () => {
      roleRepository.findOne.mockResolvedValue(role);
      permissionRepository.findOne.mockResolvedValue(permission);
      rolePermissionRepository.findOne.mockResolvedValue(null);
      rolePermissionRepository.save.mockResolvedValue({
        roleId: role.id,
        permissionId: permission.id,
      } as RolePermission);

      await service.assignPermissionToRole(role.id, permission.id);

      expect(rolePermissionRepository.save).toHaveBeenCalledWith({
        roleId: role.id,
        permissionId: permission.id,
      });
    });
  });

  describe('assignRoleToUser', () => {
    it('should assign a role to a user', async () => {
      roleRepository.findOne.mockResolvedValue(role);
      userRoleRepository.findOne.mockResolvedValue(null);

      await service.assignRoleToUser('user-1', role.id, 'admin-1');

      expect(userRoleRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-1',
          roleId: role.id,
          assignedBy: 'admin-1',
        }),
      );
    });
  });
});
