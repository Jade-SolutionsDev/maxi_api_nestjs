import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Role, User } from '../users/entities/user.entity';
import { Permission } from './entities/permission.entity';
import { ManagedRole } from './entities/role.entity';
import { RolePermission } from './entities/role-permission.entity';
import { UserRole } from './entities/user-role.entity';
import { MODULE_ACTIONS, PermissionsService } from './permissions.service';

// The full catalog, as seeded rows (id = "module:action" for readability).
const catalogRows = Object.entries(MODULE_ACTIONS).flatMap(
  ([module, actions]) =>
    actions.map((action) => ({
      id: `${module}:${action}`,
      module,
      action,
      isActive: true,
    })),
);

describe('PermissionsService', () => {
  let service: PermissionsService;
  let permissionRepo: {
    findOne: jest.Mock;
    find: jest.Mock;
    save: jest.Mock;
    count: jest.Mock;
  };
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
  let userRepo: { findOne: jest.Mock; find: jest.Mock };

  beforeEach(async () => {
    permissionRepo = {
      findOne: jest.fn(),
      find: jest.fn(),
      save: jest.fn(),
      count: jest.fn(),
    };
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
    userRepo = { findOne: jest.fn(), find: jest.fn() };

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

  describe('onModuleInit seeding', () => {
    it('seeds the full catalog and both base roles on a fresh DB', async () => {
      // seedPermissions sees an empty table; later reads see the catalog.
      permissionRepo.find
        .mockResolvedValueOnce([])
        .mockResolvedValue(catalogRows);
      permissionRepo.save.mockResolvedValue([]);
      roleRepo.findOne.mockResolvedValue(null); // no base role ever existed
      roleRepo.save.mockImplementation((r: { systemKey: string }) =>
        Promise.resolve({ ...r, id: `role-${r.systemKey}` }),
      );
      rolePermissionRepo.save.mockResolvedValue([]);

      await service.onModuleInit();

      // Every catalog row inserted in one write.
      expect(permissionRepo.save).toHaveBeenCalledTimes(1);
      expect(permissionRepo.save.mock.calls[0][0]).toHaveLength(
        catalogRows.length,
      );

      // Both base roles created as EDITABLE (isSystem: false).
      expect(roleRepo.save).toHaveBeenCalledTimes(2);
      expect(roleRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          systemKey: 'GROCER',
          isSystem: false,
          isActive: true,
        }),
      );
      expect(roleRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ systemKey: 'KARDIST', isSystem: false }),
      );

      // Grants mirror the pre-collapse baselines (+ direct jump for the
      // Almacenero template): 20 for GROCER, 8 for KARDIST.
      const grantCalls = rolePermissionRepo.save.mock.calls;
      expect(grantCalls[0][0]).toHaveLength(20);
      expect(grantCalls[1][0]).toHaveLength(8);
      expect(grantCalls[0][0]).toContainEqual({
        roleId: 'role-GROCER',
        permissionId: 'products:create',
      });
      expect(grantCalls[1][0]).toContainEqual({
        roleId: 'role-KARDIST',
        permissionId: 'inventory:aggregate',
      });

      // Nobody is auto-assigned anymore — invitations carry explicit roles.
      expect(userRoleRepo.save).not.toHaveBeenCalled();
      expect(userRepo.find).not.toHaveBeenCalled();
    });

    it('seeds only missing permission rows (diff, not blind insert)', async () => {
      const [first, ...rest] = catalogRows;
      permissionRepo.find
        .mockResolvedValueOnce(rest) // everything but one row already there
        .mockResolvedValue(catalogRows);
      permissionRepo.save.mockResolvedValue([]);
      roleRepo.findOne.mockResolvedValue({ id: 'r1' }); // base roles done

      await service.onModuleInit();

      expect(permissionRepo.save).toHaveBeenCalledTimes(1);
      expect(permissionRepo.save.mock.calls[0][0]).toEqual([
        expect.objectContaining({ module: first.module, action: first.action }),
      ]);
    });

    it('never recreates a base role that existed — even soft-deleted', async () => {
      permissionRepo.find.mockResolvedValue(catalogRows);
      // Admin deleted the base role; the seeder must respect that forever.
      roleRepo.findOne.mockResolvedValue({ id: 'r1', deletedAt: new Date() });

      await service.onModuleInit();

      expect(roleRepo.findOne).toHaveBeenCalledWith(
        expect.objectContaining({ withDeleted: true }),
      );
      expect(roleRepo.save).not.toHaveBeenCalled();
      expect(userRoleRepo.save).not.toHaveBeenCalled();
    });
  });

  describe('assignRolesLenient', () => {
    it('is a no-op for an empty list', async () => {
      await service.assignRolesLenient('u1', []);
      expect(roleRepo.find).not.toHaveBeenCalled();
      expect(userRoleRepo.save).not.toHaveBeenCalled();
    });

    it('skips roles deleted/deactivated since the invitation', async () => {
      roleRepo.find.mockResolvedValue([{ id: 'r1', isActive: true }]);
      await service.assignRolesLenient('u1', ['r1', 'r-gone', 'r1']);
      expect(userRoleRepo.save).toHaveBeenCalledWith([
        { userId: 'u1', roleId: 'r1', assignedBy: null },
      ]);
    });

    it('writes nothing when no invited role survives', async () => {
      roleRepo.find.mockResolvedValue([]);
      await service.assignRolesLenient('u1', ['r-gone']);
      expect(userRoleRepo.save).not.toHaveBeenCalled();
    });
  });

  describe('assertActiveRoles', () => {
    it('passes when every id is an active role', async () => {
      roleRepo.count.mockResolvedValue(2);
      await expect(
        service.assertActiveRoles(['r1', 'r2', 'r1']),
      ).resolves.toBeUndefined();
    });

    it('throws when any id is unknown or inactive', async () => {
      roleRepo.count.mockResolvedValue(1);
      await expect(
        service.assertActiveRoles(['r1', 'r2']),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('getRolesByUserIds', () => {
    it('maps users to their ACTIVE roles in one query', async () => {
      userRoleRepo.find.mockResolvedValue([
        {
          userId: 'u1',
          role: { id: 'r1', name: 'Financista', isActive: true },
        },
        { userId: 'u1', role: { id: 'r2', name: 'Muerto', isActive: false } },
        { userId: 'u2', role: null }, // soft-deleted relation
      ]);
      await expect(service.getRolesByUserIds(['u1', 'u2'])).resolves.toEqual({
        u1: [{ id: 'r1', name: 'Financista' }],
      });
      expect(userRoleRepo.find).toHaveBeenCalledTimes(1);
    });
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

    it('denies a non-admin with no assigned roles (no hard-coded baseline)', async () => {
      permissionRepo.findOne.mockResolvedValue({ id: 'perm-1' });
      userRoleRepo.find.mockResolvedValue([]);
      await expect(
        service.hasPermission('u1', Role.STAFF, 'products', 'create'),
      ).resolves.toBe(false);
    });

    it('grants via an assigned managed role', async () => {
      permissionRepo.findOne.mockResolvedValue({ id: 'perm-1' });
      userRoleRepo.find.mockResolvedValue([
        { roleId: 'r1', role: { isActive: true, deletedAt: null } },
      ]);
      rolePermissionRepo.count.mockResolvedValue(1);
      await expect(
        service.hasPermission('u1', Role.STAFF, 'products', 'update'),
      ).resolves.toBe(true);
      expect(rolePermissionRepo.count).toHaveBeenCalled();
    });

    it('survives an assignment whose role was soft-deleted (NULL relation)', async () => {
      permissionRepo.findOne.mockResolvedValue({ id: 'perm-1' });
      userRoleRepo.find.mockResolvedValue([{ roleId: 'r1', role: null }]);
      await expect(
        service.hasPermission('u1', Role.STAFF, 'products', 'update'),
      ).resolves.toBe(false);
      expect(rolePermissionRepo.count).not.toHaveBeenCalled();
    });
  });

  describe('getUserIdsWithModuleGrant', () => {
    it('returns distinct users whose ACTIVE roles grant the module', async () => {
      permissionRepo.find.mockResolvedValue([{ id: 'p1' }, { id: 'p2' }]);
      rolePermissionRepo.find.mockResolvedValue([
        { roleId: 'r1', permissionId: 'p1' },
        { roleId: 'r2', permissionId: 'p2' },
      ]);
      userRoleRepo.find.mockResolvedValue([
        { userId: 'u1', roleId: 'r1', role: { isActive: true } },
        { userId: 'u1', roleId: 'r2', role: { isActive: true } }, // dupe user
        { userId: 'u2', roleId: 'r2', role: { isActive: false } }, // inactive role
        { userId: 'u3', roleId: 'r1', role: null }, // soft-deleted role
      ]);

      await expect(
        service.getUserIdsWithModuleGrant('stock-locations'),
      ).resolves.toEqual(['u1']);
    });

    it('short-circuits when nothing grants the module', async () => {
      permissionRepo.find.mockResolvedValue([{ id: 'p1' }]);
      rolePermissionRepo.find.mockResolvedValue([]);
      await expect(
        service.getUserIdsWithModuleGrant('stock-locations'),
      ).resolves.toEqual([]);
      expect(userRoleRepo.find).not.toHaveBeenCalled();
    });
  });

  describe('getUserPermissions', () => {
    it('returns the FULL catalog for an admin', async () => {
      userRepo.findOne.mockResolvedValue({ id: 'u1', role: Role.ADMIN });
      const result = await service.getUserPermissions('u1');
      expect(Object.keys(result.permissions)).toEqual(
        Object.keys(MODULE_ACTIONS),
      );
      expect(result.permissions.products).toEqual([
        'list',
        'read',
        'create',
        'update',
        'delete',
      ]);
      expect(result.permissions.dashboard).toEqual(['view']);
      expect(result.user.role).toBe(Role.ADMIN);
    });

    it('returns only managed grants for non-admins', async () => {
      userRepo.findOne.mockResolvedValue({ id: 'u1', role: Role.STAFF });
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
      expect(result.permissions).toEqual({ products: ['update'] });
      expect(result.user.roles).toEqual(['Editor']);
    });

    it('returns an empty map when the only assigned role was soft-deleted', async () => {
      userRepo.findOne.mockResolvedValue({ id: 'u1', role: Role.STAFF });
      userRoleRepo.find.mockResolvedValue([{ roleId: 'r1', role: null }]);
      const result = await service.getUserPermissions('u1');
      expect(result.permissions).toEqual({});
      expect(result.user.roles).toEqual([]);
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

    it('rejects setRolePermissions with unknown permission ids', async () => {
      roleRepo.findOne.mockResolvedValue({ id: 'r1', isSystem: false });
      permissionRepo.count.mockResolvedValue(1); // asked for 2, found 1
      await expect(
        service.setRolePermissions('r1', ['p1', 'p2']),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(rolePermissionRepo.delete).not.toHaveBeenCalled();
    });

    it('replaces the grant set when all ids are valid', async () => {
      roleRepo.findOne.mockResolvedValue({ id: 'r1', isSystem: false });
      permissionRepo.count.mockResolvedValue(2);
      await service.setRolePermissions('r1', ['p1', 'p2', 'p1']); // dupes collapse
      expect(rolePermissionRepo.delete).toHaveBeenCalledWith({ roleId: 'r1' });
      expect(rolePermissionRepo.save).toHaveBeenCalledWith([
        { roleId: 'r1', permissionId: 'p1' },
        { roleId: 'r1', permissionId: 'p2' },
      ]);
    });

    it('deleteRole removes its assignments before soft-deleting', async () => {
      roleRepo.findOne.mockResolvedValue({ id: 'r1', isSystem: false });
      await service.deleteRole('r1');
      expect(userRoleRepo.delete).toHaveBeenCalledWith({ roleId: 'r1' });
      expect(roleRepo.softDelete).toHaveBeenCalledWith('r1');
    });

    it('validates all role ids exist on setUserRoles', async () => {
      roleRepo.count.mockResolvedValue(1); // asked for 2, found 1
      await expect(
        service.setUserRoles('u1', ['r1', 'r2'], 'admin'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
