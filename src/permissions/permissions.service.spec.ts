import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Permission } from './entities/permission.entity';
import { RolePermission } from './entities/role-permission.entity';
import { Role } from './entities/role.entity';
import { UserRole } from './entities/user-role.entity';
import { PermissionsService } from './permissions.service';

describe('PermissionsService', () => {
  let service: PermissionsService;
  let permissionRepository: jest.Mocked<Repository<Permission>>;
  let roleRepository: jest.Mocked<Repository<Role>>;
  let rolePermissionRepository: jest.Mocked<Repository<RolePermission>>;
  let userRoleRepository: jest.Mocked<Repository<UserRole>>;

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
      ],
    }).compile();

    service = module.get<PermissionsService>(PermissionsService);
    permissionRepository = module.get(getRepositoryToken(Permission));
    roleRepository = module.get(getRepositoryToken(Role));
    rolePermissionRepository = module.get(getRepositoryToken(RolePermission));
    userRoleRepository = module.get(getRepositoryToken(UserRole));
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
    it('should return all permissions for admin', async () => {
      const result = await service.getUserPermissions('user-1', 'admin');
      expect(result.permissions.products).toContain('read');
      expect(result.permissions.orders).toContain('create');
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
