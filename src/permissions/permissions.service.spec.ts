import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { In } from 'typeorm';
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
    delete: jest.Mock;
    createQueryBuilder: jest.Mock;
  };
  let rolePermissionRepo: {
    count: jest.Mock;
    find: jest.Mock;
    delete: jest.Mock;
    save: jest.Mock;
  };
  let userRoleRepo: { find: jest.Mock; delete: jest.Mock; save: jest.Mock };
  let userRepo: { findOne: jest.Mock; find: jest.Mock };
  /**
   * Los roles que ya están en la base, para la comprobación de nombre
   * repetido. El constructor de consultas falso los filtra con la misma regla
   * que pide el SQL —en minúsculas—, y además se guarda la cláusula que se
   * generó para poder comprobarla: si alguien quita el `LOWER(`, el fake
   * seguiría acertando y la prueba no se enteraría.
   */
  let rolesEnBase: { id: string; name: string }[];
  let clausulas: string[];

  beforeEach(async () => {
    permissionRepo = {
      findOne: jest.fn(),
      find: jest.fn(),
      save: jest.fn(),
      count: jest.fn(),
    };
    rolesEnBase = [];
    clausulas = [];
    roleRepo = {
      findOne: jest.fn(),
      find: jest.fn(),
      save: jest.fn(),
      count: jest.fn(),
      softDelete: jest.fn(),
      delete: jest.fn(),
      createQueryBuilder: jest.fn(() => {
        let nombre = '';
        let excepto: string | undefined;
        const constructor = {
          withDeleted: () => constructor,
          where: (sql: string, params: { nombre: string }) => {
            clausulas.push(sql);
            nombre = params.nombre;
            return constructor;
          },
          andWhere: (sql: string, params: { excepto: string }) => {
            clausulas.push(sql);
            excepto = params.excepto;
            return constructor;
          },
          getCount: () =>
            Promise.resolve(
              rolesEnBase.filter(
                (r) =>
                  r.name.toLowerCase() === nombre.toLowerCase() &&
                  r.id !== excepto,
              ).length,
            ),
        };
        return constructor;
      }),
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
    it('seeds the full catalog and every base role on a fresh DB', async () => {
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

      // Every base role created as EDITABLE (isSystem: false).
      expect(roleRepo.save).toHaveBeenCalledTimes(3);
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
      expect(roleRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ systemKey: 'WEB_MANAGER', isSystem: false }),
      );

      // El Almacenero nace con lo que MxH-0036 define: 12 permisos para GROCER,
      // 8 para KARDIST.
      const grantCalls = rolePermissionRepo.save.mock.calls;
      expect(grantCalls[0][0]).toHaveLength(12);
      expect(grantCalls[1][0]).toHaveLength(8);
      expect(grantCalls[0][0]).toContainEqual({
        roleId: 'role-GROCER',
        permissionId: 'inventory:create-operation',
      });
      expect(grantCalls[1][0]).toContainEqual({
        roleId: 'role-KARDIST',
        permissionId: 'inventory:aggregate',
      });

      // Nobody is auto-assigned anymore — invitations carry explicit roles.
      expect(userRoleRepo.save).not.toHaveBeenCalled();
      expect(userRepo.find).not.toHaveBeenCalled();
    });

    // MxH-0036: el Jefe de almacenes opera almacenes e inventario y **consulta**
    // el catálogo. La plantilla no puede nacer pudiendo tocar productos ni
    // almacenes: un rol que nace de más rara vez se recorta después.
    it('el Almacenero nace sin poder escribir en catálogo, almacenes ni pedidos', async () => {
      // Igual que la prueba de arriba: la primera lectura ve la tabla vacía y
      // las siguientes ya ven el catálogo sembrado, que es de donde salen los ids.
      permissionRepo.find
        .mockResolvedValueOnce([])
        .mockResolvedValue(catalogRows);
      permissionRepo.save.mockResolvedValue([]);
      roleRepo.findOne.mockResolvedValue(null);
      roleRepo.save.mockImplementation((r: { systemKey: string }) =>
        Promise.resolve({ ...r, id: `role-${r.systemKey}` }),
      );
      rolePermissionRepo.save.mockResolvedValue([]);

      await service.onModuleInit();

      const concedidos = (
        rolePermissionRepo.save.mock.calls[0][0] as { permissionId: string }[]
      ).map((g) => g.permissionId);

      // Consulta sí.
      expect(concedidos).toContain('products:list');
      expect(concedidos).toContain('products:read');
      expect(concedidos).toContain('stock-locations:list');
      expect(concedidos).toContain('inventory:create-operation');

      // Escritura no, en ninguna de sus formas.
      for (const prohibido of [
        'products:create',
        'products:update',
        'products:delete',
        'stock-locations:create',
        'stock-locations:update',
        'stock-locations:delete',
      ]) {
        expect(concedidos).not.toContain(prohibido);
      }
      // Los pedidos son de otro rol: ni uno solo.
      expect(concedidos.filter((p) => p.startsWith('orders:'))).toHaveLength(0);
    });

    it('el responsable de la web nace editando y publicando la portada y los textos, sin tocar catálogo ni pedidos', async () => {
      permissionRepo.find
        .mockResolvedValueOnce([])
        .mockResolvedValue(catalogRows);
      permissionRepo.save.mockResolvedValue([]);
      roleRepo.findOne.mockResolvedValue(null);
      roleRepo.save.mockImplementation((r: { systemKey: string }) =>
        Promise.resolve({ ...r, id: `role-${r.systemKey}` }),
      );
      rolePermissionRepo.save.mockResolvedValue([]);

      await service.onModuleInit();

      const concedidos = (
        rolePermissionRepo.save.mock.calls[2][0] as {
          roleId: string;
          permissionId: string;
        }[]
      ).map((g) => g.permissionId);

      expect(concedidos).toEqual(
        expect.arrayContaining([
          'cms-home:read',
          'cms-home:update',
          'cms-home:publish',
          'cms-banners:create',
          'cms-banners:update',
          'cms-banners:delete',
          'cms-pages:list',
          'cms-pages:read',
          'cms-pages:create',
          'cms-pages:update',
          'cms-pages:delete',
          'cms-pages:publish',
          'uploads:create',
          'products:list',
          'departments:list',
          'categories:list',
        ]),
      );
      expect(concedidos).toHaveLength(21);
      expect(
        concedidos.filter(
          (p) =>
            p.startsWith('orders:') ||
            ['products:create', 'products:update', 'products:delete'].includes(
              p,
            ),
        ),
      ).toHaveLength(0);
    });

    it('publicar la portada es un permiso distinto de editarla', () => {
      expect(MODULE_ACTIONS['cms-home']).toEqual(['read', 'update', 'publish']);
    });

    it('publicar un texto legal es un permiso distinto de editar su borrador', () => {
      expect(MODULE_ACTIONS['cms-pages']).toEqual([
        'list',
        'read',
        'create',
        'update',
        'delete',
        'publish',
      ]);
    });

    it('ofrece «create» en pedidos, separado de los cambios de estado', () => {
      expect(MODULE_ACTIONS.orders).toContain('create');
      // Crear un pedido ajeno mueve stock e inventa deuda: no puede venir
      // colgado del permiso de avanzar uno que ya existe.
      expect(MODULE_ACTIONS.orders).toContain('update-status');
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
    it('listRoles busca por nombre o descripción cuando hay texto', async () => {
      roleRepo.find.mockResolvedValue([]);

      await service.listRoles();
      expect(roleRepo.find).toHaveBeenLastCalledWith({});

      await service.listRoles('finan');
      expect(roleRepo.find).toHaveBeenLastCalledWith({
        where: [
          { name: expect.objectContaining({ _type: 'raw' }) },
          { description: expect.objectContaining({ _type: 'raw' }) },
        ],
      });
    });

    it('rejects creating a duplicate role', async () => {
      rolesEnBase.push({ id: 'r1', name: 'Dup' });
      await expect(service.createRole({ name: 'Dup' })).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    /**
     * MxH-0036: así nació el lío. Staging tiene «Almacenero» sembrado y «jefe
     * de almacenes » hecho a mano al día siguiente, con un espacio al final
     * que nadie ve y permisos distintos. La comprobación de duplicados
     * comparaba las cadenas tal cual, así que los dejó pasar a los dos.
     */
    it('un nombre que solo cambia en espacios o mayúsculas es el mismo', async () => {
      rolesEnBase.push({ id: 'r1', name: 'Jefe de almacenes' });

      for (const repetido of [
        'jefe de almacenes',
        'Jefe de almacenes ',
        '  JEFE DE ALMACENES',
        'Jefe  de   almacenes',
      ]) {
        await expect(
          service.createRole({ name: repetido }),
        ).rejects.toBeInstanceOf(ConflictException);
      }
      expect(roleRepo.save).not.toHaveBeenCalled();
    });

    // Que el fake no esté acertando por su cuenta: la comparación tiene que
    // pedirla el SQL, no el doble de prueba.
    it('la comparación la hace la base en minúsculas', async () => {
      rolesEnBase.push({ id: 'r1', name: 'Jefe de almacenes' });
      await expect(
        service.createRole({ name: 'JEFE DE ALMACENES' }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(clausulas[0]).toContain('LOWER(rol.name) = LOWER(:nombre)');
    });

    it('el nombre se guarda limpio', async () => {
      roleRepo.save.mockResolvedValue({ id: 'r-nuevo' });
      await service.createRole({ name: '  Jefe  de  almacenes  ' });
      expect(roleRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Jefe de almacenes' }),
      );
    });

    it('renombrar a un nombre ya usado tampoco vale, y uno no choca consigo mismo', async () => {
      rolesEnBase.push(
        { id: 'r1', name: 'Jefe de almacenes' },
        { id: 'r2', name: 'Economista' },
      );
      roleRepo.findOne.mockResolvedValue({ id: 'r2', isSystem: false });

      await expect(
        service.updateRole('r2', { name: 'jefe de almacenes ' }),
      ).rejects.toBeInstanceOf(ConflictException);

      roleRepo.save.mockResolvedValue({ id: 'r2' });
      await expect(
        service.updateRole('r2', { name: 'Economista' }),
      ).resolves.toBeDefined();
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
      permissionRepo.find.mockResolvedValue([
        { id: 'p1', module: 'products', action: 'list' },
      ]); // asked for 2, found 1
      await expect(
        service.setRolePermissions('r1', ['p1', 'p2']),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(rolePermissionRepo.delete).not.toHaveBeenCalled();
    });

    it('replaces the grant set when all ids are valid', async () => {
      roleRepo.findOne.mockResolvedValue({ id: 'r1', isSystem: false });
      permissionRepo.find.mockResolvedValue([
        { id: 'p1', module: 'products', action: 'list' },
        { id: 'p2', module: 'products', action: 'read' },
      ]);
      await service.setRolePermissions('r1', ['p1', 'p2', 'p1']); // dupes collapse
      expect(rolePermissionRepo.delete).toHaveBeenCalledWith({ roleId: 'r1' });
      expect(rolePermissionRepo.save).toHaveBeenCalledWith([
        { roleId: 'r1', permissionId: 'p1' },
        { roleId: 'r1', permissionId: 'p2' },
      ]);
    });

    it('conceder «crear» arrastra «listar» y «ver» del mismo módulo', async () => {
      roleRepo.findOne.mockResolvedValue({ id: 'r1', isSystem: false });
      permissionRepo.find
        // los pedidos
        .mockResolvedValueOnce([
          { id: 'p-create', module: 'products', action: 'create' },
        ])
        // las lecturas que faltan, del propio módulo y de los que lo pintan
        .mockResolvedValueOnce([
          { id: 'p-list', module: 'products', action: 'list' },
          { id: 'p-read', module: 'products', action: 'read' },
        ]);

      await service.setRolePermissions('r1', ['p-create']);

      expect(rolePermissionRepo.save).toHaveBeenCalledWith([
        { roleId: 'r1', permissionId: 'p-create' },
        { roleId: 'r1', permissionId: 'p-list' },
        { roleId: 'r1', permissionId: 'p-read' },
      ]);
    });

    it('un rol de solo lectura sobre un módulo suelto se queda como está', async () => {
      roleRepo.findOne.mockResolvedValue({ id: 'r1', isSystem: false });
      // `clients` no depende de ningún otro módulo para pintarse.
      permissionRepo.find.mockResolvedValue([
        { id: 'p-list', module: 'clients', action: 'list' },
      ]);

      await service.setRolePermissions('r1', ['p-list']);

      expect(permissionRepo.find).toHaveBeenCalledTimes(1);
      expect(rolePermissionRepo.save).toHaveBeenCalledWith([
        { roleId: 'r1', permissionId: 'p-list' },
      ]);
    });

    it('mirar productos arrastra ver categorías y departamentos, que es lo que los filtra', async () => {
      roleRepo.findOne.mockResolvedValue({ id: 'r1', isSystem: false });
      permissionRepo.find
        .mockResolvedValueOnce([
          { id: 'p-list', module: 'products', action: 'list' },
        ])
        .mockResolvedValueOnce([
          { id: 'cat-list', module: 'categories', action: 'list' },
          { id: 'dep-list', module: 'departments', action: 'list' },
        ]);

      await service.setRolePermissions('r1', ['p-list']);

      expect(rolePermissionRepo.save).toHaveBeenCalledWith([
        { roleId: 'r1', permissionId: 'p-list' },
        { roleId: 'r1', permissionId: 'cat-list' },
        { roleId: 'r1', permissionId: 'dep-list' },
      ]);
    });

    it('editar la portada arrastra ver productos, departamentos y banners, que son sus selectores', async () => {
      roleRepo.findOne.mockResolvedValue({ id: 'r1', isSystem: false });
      permissionRepo.find
        .mockResolvedValueOnce([
          { id: 'home-update', module: 'cms-home', action: 'update' },
        ])
        .mockResolvedValueOnce([]);

      await service.setRolePermissions('r1', ['home-update']);

      expect(permissionRepo.find).toHaveBeenLastCalledWith({
        where: expect.objectContaining({
          module: In(['cms-home', 'products', 'departments', 'cms-banners']),
        }),
      });
    });

    it('los banners arrastran ver lo que pueden enlazar: productos, categorías y departamentos', async () => {
      roleRepo.findOne.mockResolvedValue({ id: 'r1', isSystem: false });
      permissionRepo.find
        .mockResolvedValueOnce([
          { id: 'banner-create', module: 'cms-banners', action: 'create' },
        ])
        .mockResolvedValueOnce([]);

      await service.setRolePermissions('r1', ['banner-create']);

      expect(permissionRepo.find).toHaveBeenLastCalledWith({
        where: expect.objectContaining({
          module: In(['cms-banners', 'products', 'categories', 'departments']),
        }),
      });
    });

    it('un rol sin ningún permiso no se guarda', async () => {
      roleRepo.findOne.mockResolvedValue({ id: 'r1', isSystem: false });
      await expect(service.setRolePermissions('r1', [])).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(rolePermissionRepo.delete).not.toHaveBeenCalled();
    });

    it('crear un rol con permisos lo deja listo de una vez', async () => {
      roleRepo.findOne.mockResolvedValue({ id: 'r-nuevo', isSystem: false });
      roleRepo.save.mockResolvedValue({ id: 'r-nuevo', isSystem: false });
      permissionRepo.find.mockResolvedValue([
        { id: 'p-list', module: 'clients', action: 'list' },
      ]);

      const role = await service.createRole({
        name: 'Económico',
        permissionIds: ['p-list'],
      });

      expect(role.id).toBe('r-nuevo');
      expect(rolePermissionRepo.save).toHaveBeenCalledWith([
        { roleId: 'r-nuevo', permissionId: 'p-list' },
      ]);
    });

    it('si los permisos no valen, no queda un rol huérfano', async () => {
      roleRepo.findOne
        .mockResolvedValueOnce(null) // no existe otro con ese nombre
        .mockResolvedValue({ id: 'r-nuevo', isSystem: false });
      roleRepo.save.mockResolvedValue({ id: 'r-nuevo', isSystem: false });
      permissionRepo.find.mockResolvedValue([]); // ninguno de los pedidos existe

      await expect(
        service.createRole({ name: 'Roto', permissionIds: ['p-inventado'] }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(roleRepo.delete).toHaveBeenCalledWith('r-nuevo');
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
