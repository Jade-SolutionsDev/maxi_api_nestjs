import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Role, User } from '../users/entities/user.entity';
import { Permission } from './entities/permission.entity';
import { ManagedRole } from './entities/role.entity';
import { RolePermission } from './entities/role-permission.entity';
import { UserRole } from './entities/user-role.entity';
import { PermissionsService } from './permissions.service';

describe('PermissionsService', () => {
  let service: PermissionsService;
  let permissionRepo: { findOne: jest.Mock; find: jest.Mock; save: jest.Mock };
  let roleRepo: {
    findOne: jest.Mock;
    find: jest.Mock;
    save: jest.Mock;
    count: jest.Mock;
    softDelete: jest.Mock;
  };
  let rolePermissionRepo: {
    count: jest.Mock;
    find: jest.Mock;
    delete: jest.Mock;
    save: jest.Mock;
  };
  let userRoleRepo: { find: jest.Mock; delete: jest.Mock; save: jest.Mock };
  let userRepo: { findOne: jest.Mock };

  beforeEach(async () => {
    permissionRepo = { findOne: jest.fn(), find: jest.fn(), save: jest.fn() };
    roleRepo = {
      findOne: jest.fn(),
      find: jest.fn(),
      save: jest.fn(),
      count: jest.fn(),
      softDelete: jest.fn(),
    };
    rolePermissionRepo = {
      count: jest.fn(),
      find: jest.fn(),
      delete: jest.fn(),
      save: jest.fn(),
    };
    userRoleRepo = { find: jest.fn(), delete: jest.fn(), save: jest.fn() };
    userRepo = { findOne: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PermissionsService,
        { provide: getRepositoryToken(Permission), useValue: permissionRepo },
        { provide: getRepositoryToken(ManagedRole), useValue: roleRepo },
        {
          provide: getRepositoryToken(RolePermission),
          useValue: rolePermissionRepo,
        },
        { provide: getRepositoryToken(UserRole), useValue: userRoleRepo },
        { provide: getRepositoryToken(User), useValue: userRepo },
      ],
    }).compile();

    service = module.get(PermissionsService);
  });

  describe('hasPermission', () => {
    it('lets system admins bypass without any lookup', async () => {
      await expect(
        service.hasPermission('u1', Role.SUPER_ADMIN, 'products', 'delete'),
      ).resolves.toBe(true);
      await expect(
        service.hasPermission('u1', Role.ADMIN, 'products', 'delete'),
      ).resolves.toBe(true);
      expect(permissionRepo.findOne).not.toHaveBeenCalled();
    });

    it('grants the enum baseline (GROCER can create products)', async () => {
      await expect(
        service.hasPermission('u1', Role.GROCER, 'products', 'create'),
      ).resolves.toBe(true);
      expect(permissionRepo.findOne).not.toHaveBeenCalled();
    });

    it('denies outside baseline when the user has no managed role', async () => {
      // KARDIST has no products access by default.
      permissionRepo.findOne.mockResolvedValue({ id: 'perm-1' });
      userRoleRepo.find.mockResolvedValue([]);
      await expect(
        service.hasPermission('u1', Role.KARDIST, 'products', 'read'),
      ).resolves.toBe(false);
    });

    it('grants via an assigned managed role', async () => {
      permissionRepo.findOne.mockResolvedValue({ id: 'perm-1' });
      userRoleRepo.find.mockResolvedValue([
        { roleId: 'r1', role: { isActive: true, deletedAt: null } },
      ]);
      rolePermissionRepo.count.mockResolvedValue(1);
      await expect(
        service.hasPermission('u1', Role.KARDIST, 'products', 'update'),
      ).resolves.toBe(true);
      expect(rolePermissionRepo.count).toHaveBeenCalled();
    });
  });

  describe('getUserPermissions', () => {
    it('returns all catalog actions for an admin', async () => {
      userRepo.findOne.mockResolvedValue({ id: 'u1', role: Role.ADMIN });
      const result = await service.getUserPermissions('u1');
      expect(result.permissions.products).toEqual([
        'list',
        'read',
        'create',
        'update',
        'delete',
      ]);
      expect(result.user.role).toBe(Role.ADMIN);
    });

    it('merges enum baseline with managed grants for non-admins', async () => {
      userRepo.findOne.mockResolvedValue({ id: 'u1', role: Role.KARDIST });
      userRoleRepo.find.mockResolvedValue([
        {
          roleId: 'r1',
          role: { id: 'r1', name: 'Editor', isActive: true, deletedAt: null },
        },
      ]);
      rolePermissionRepo.find.mockResolvedValue([
        {
          permission: { module: 'products', action: 'update', isActive: true },
        },
      ]);
      const result = await service.getUserPermissions('u1');
      // baseline: categories/departments read; managed adds products:update
      expect(result.permissions.categories).toEqual(['list', 'read']);
      expect(result.permissions.products).toEqual(['update']);
      expect(result.user.roles).toEqual(['Editor']);
    });
  });

  describe('role management', () => {
    it('rejects creating a duplicate role', async () => {
      roleRepo.findOne.mockResolvedValue({ id: 'r1' });
      await expect(service.createRole({ name: 'Dup' })).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('blocks modifying a system role', async () => {
      roleRepo.findOne.mockResolvedValue({ id: 'r1', isSystem: true });
      await expect(
        service.updateRole('r1', { name: 'x' }),
      ).rejects.toBeInstanceOf(ConflictException);
      await expect(
        service.setRolePermissions('r1', ['p1']),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('validates all role ids exist on setUserRoles', async () => {
      roleRepo.count.mockResolvedValue(1); // asked for 2, found 1
      await expect(
        service.setUserRoles('u1', ['r1', 'r2'], 'admin'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
