import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Role, User } from '../users/entities/user.entity';
import { UpdateRoleDto } from './dto/update-role.dto';
import { Permission } from './entities/permission.entity';
import { ManagedRole } from './entities/role.entity';
import { RolePermission } from './entities/role-permission.entity';
import { UserRole } from './entities/user-role.entity';

export interface PermissionRef {
  module: string;
  action: string;
}

export interface UserPermissionsPayload {
  user: {
    id: string;
    role: string | null;
    roles: string[];
  };
  permissions: Record<string, string[]>;
}

const CRUD = ['list', 'read', 'create', 'update', 'delete'] as const;

/**
 * THE permission catalog: every grantable backoffice module and its actions.
 * Keys match the frontend resource names 1:1 (see authProvider RESOURCE_RULES).
 *
 * RULE (see workspace CLAUDE.md): a new backoffice module MUST be registered
 * here and its routes decorated with @RequirePermission, or it will be a 403
 * for every non-admin — the PermissionGuard denies undecorated routes by
 * design. `users` and `permissions` are deliberately absent: they stay
 * @Roles(SUPER_ADMIN, ADMIN) and are never grantable.
 */
export const MODULE_ACTIONS: Record<string, readonly string[]> = {
  products: CRUD,
  categories: CRUD,
  departments: CRUD,
  'stock-locations': CRUD,
  nomenclators: CRUD,
  'delivery-options': CRUD,
  clients: CRUD,
  'cms-pages': CRUD,
  'cms-banners': CRUD,
  'cms-services': CRUD,
  'cms-staff': CRUD,
  // Support inbox + reply templates share one module; `reply` is split from
  // `update` so triage and customer-facing replies are separately grantable.
  contact: [...CRUD, 'reply'],
  orders: ['list', 'read', 'update-status', 'update-payment-status'],
  inventory: ['list', 'read', 'aggregate', 'history', 'create-operation'],
  'cms-settings': ['read', 'update'],
  'fulfillment-settings': ['read', 'update'],
  'payment-methods': ['list', 'update'],
  dashboard: ['view'],
  uploads: ['create'],
};

/** System-admin tiers bypass all permission checks. */
export const isSystemAdmin = (role: string | null): boolean =>
  (role as Role) === Role.SUPER_ADMIN || (role as Role) === Role.ADMIN;

/**
 * Seeded, EDITABLE base roles — they replace the old hard-coded enum baselines.
 * Created (with these grants) and auto-assigned to existing users of the enum
 * role exactly once: the first boot where no role with that `systemKey` has
 * ever existed. After that, admins own them completely — rename, regrant,
 * unassign or delete; the seeder never reasserts anything.
 *
 * Grants mirror the access GROCER/KARDIST had under the old @Roles gating.
 */
const BASE_ROLES: ReadonlyArray<{
  systemKey: Role;
  name: string;
  description: string;
  grants: Record<string, readonly string[]>;
}> = [
  {
    systemKey: Role.GROCER,
    name: 'Almacenero — base',
    description:
      'Permisos iniciales del rol Almacenero. Ajústalos o retíralos según lo que necesite tu equipo.',
    grants: {
      products: CRUD,
      categories: ['list', 'read'],
      departments: ['list', 'read'],
      'stock-locations': ['list', 'read', 'update'],
      orders: ['list', 'read', 'update-status'],
      inventory: ['list', 'read', 'history', 'create-operation'],
    },
  },
  {
    systemKey: Role.KARDIST,
    name: 'Kardista — base',
    description:
      'Permisos iniciales del rol Kardista. Ajústalos o retíralos según lo que necesite tu equipo.',
    grants: {
      categories: ['list', 'read'],
      departments: ['list', 'read'],
      inventory: ['read', 'aggregate', 'history'],
      uploads: ['create'],
    },
  },
];

@Injectable()
export class PermissionsService implements OnModuleInit {
  private readonly logger = new Logger(PermissionsService.name);

  constructor(
    @InjectRepository(Permission)
    private readonly permissionRepository: Repository<Permission>,
    @InjectRepository(ManagedRole)
    private readonly roleRepository: Repository<ManagedRole>,
    @InjectRepository(RolePermission)
    private readonly rolePermissionRepository: Repository<RolePermission>,
    @InjectRepository(UserRole)
    private readonly userRoleRepository: Repository<UserRole>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.seedPermissions();
    await this.seedBaseRoles();
  }

  /** Diff-seed the catalog: one read, one write of whatever rows are missing. */
  private async seedPermissions(): Promise<void> {
    const existing = await this.permissionRepository.find();
    const have = new Set(existing.map((p) => `${p.module}:${p.action}`));

    const missing: Array<Partial<Permission>> = [];
    for (const [module, actions] of Object.entries(MODULE_ACTIONS)) {
      for (const action of actions) {
        if (!have.has(`${module}:${action}`)) {
          missing.push({
            module,
            action,
            description: `${action} ${module}`,
            isActive: true,
          });
        }
      }
    }
    if (missing.length > 0) {
      await this.permissionRepository.save(missing);
      this.logger.log(`Seeded ${missing.length} permission(s).`);
    }
  }

  /**
   * One-time creation of the editable base roles (+ grants + assignment to all
   * existing users of the matching enum role). `withDeleted` makes deletion by
   * an admin final — the seeder never resurrects a base role.
   */
  private async seedBaseRoles(): Promise<void> {
    for (const base of BASE_ROLES) {
      const existing = await this.roleRepository.findOne({
        where: { systemKey: base.systemKey },
        withDeleted: true,
      });
      if (existing) continue;

      let role: ManagedRole;
      try {
        role = await this.roleRepository.save({
          name: base.name,
          description: base.description,
          systemKey: base.systemKey,
          isSystem: false, // editable — that is the whole point
          isActive: true,
          createdBy: null,
        });
      } catch {
        // Unique(system_key) collision: another instance seeded first.
        continue;
      }

      const wanted = new Set(
        Object.entries(base.grants).flatMap(([module, actions]) =>
          actions.map((action) => `${module}:${action}`),
        ),
      );
      const catalog = await this.permissionRepository.find();
      const grants = catalog.filter((p) =>
        wanted.has(`${p.module}:${p.action}`),
      );
      if (grants.length > 0) {
        await this.rolePermissionRepository.save(
          grants.map((p) => ({ roleId: role.id, permissionId: p.id })),
        );
      }

      // Includes soft-deleted users so a later restore keeps their access.
      const users = await this.userRepository.find({
        where: { role: base.systemKey },
        withDeleted: true,
      });
      if (users.length > 0) {
        await this.userRoleRepository.save(
          users.map((u) => ({
            userId: u.id,
            roleId: role.id,
            assignedBy: null,
          })),
        );
      }
      this.logger.log(
        `Seeded base role "${base.name}" and assigned ${users.length} user(s).`,
      );
    }
  }

  /**
   * Give a newly created backoffice user the base role matching their enum
   * role, if an active one exists. Composite-PK save makes it idempotent; a
   * missing/deleted base role is simply a no-op (the admin's choice stands).
   */
  async assignBaseRoleForEnumRole(userId: string, role: string): Promise<void> {
    if (isSystemAdmin(role)) return;
    const base = await this.roleRepository.findOne({
      where: { systemKey: role, isActive: true },
    });
    if (!base) return;
    await this.userRoleRepository.save({
      userId,
      roleId: base.id,
      assignedBy: null,
    });
  }

  /**
   * Effective check: system admins bypass; everyone else needs the permission
   * through an assigned active role. There is NO hard-coded baseline anymore.
   */
  async hasPermission(
    userId: string,
    role: string,
    module: string,
    action: string,
  ): Promise<boolean> {
    if (isSystemAdmin(role)) return true;

    const perm = await this.permissionRepository.findOne({
      where: { module, action, isActive: true },
    });
    if (!perm) return false;

    const roleIds = await this.getActiveRoleIdsForUser(userId);
    if (roleIds.length === 0) return false;

    const count = await this.rolePermissionRepository.count({
      where: { roleId: In(roleIds), permissionId: perm.id },
    });
    return count > 0;
  }

  private async getActiveRoleIdsForUser(userId: string): Promise<string[]> {
    const userRoles = await this.userRoleRepository.find({
      where: { userId },
      relations: { role: true },
    });
    // A soft-deleted role loads as a NULL relation — filter it, don't crash.
    return userRoles.filter((ur) => ur.role?.isActive).map((ur) => ur.roleId);
  }

  async getUserRoles(userId: string): Promise<ManagedRole[]> {
    const userRoles = await this.userRoleRepository.find({
      where: { userId },
      relations: { role: true },
    });
    return userRoles
      .map((ur) => ur.role)
      .filter((role): role is ManagedRole => Boolean(role?.isActive));
  }

  /**
   * The effective permission map for a user (full catalog for admins, the
   * union of assigned active roles for everyone else) — consumed by the
   * frontend to gate UI actions.
   */
  async getUserPermissions(userId: string): Promise<UserPermissionsPayload> {
    const permissions: Record<string, string[]> = {};

    const user = await this.userRepository.findOne({ where: { id: userId } });
    const role: string | null = user?.role ?? null;

    if (isSystemAdmin(role)) {
      for (const [module, actions] of Object.entries(MODULE_ACTIONS)) {
        permissions[module] = [...actions];
      }
      return { user: { id: userId, role, roles: [] }, permissions };
    }

    const roles = await this.getUserRoles(userId);
    if (roles.length > 0) {
      const rolePermissions = await this.rolePermissionRepository.find({
        where: { roleId: In(roles.map((r) => r.id)) },
        relations: { permission: true },
      });
      for (const rp of rolePermissions) {
        const perm = rp.permission;
        if (!perm?.isActive) continue;
        if (!permissions[perm.module]?.includes(perm.action)) {
          (permissions[perm.module] ??= []).push(perm.action);
        }
      }
    }

    return {
      user: { id: userId, role, roles: roles.map((r) => r.name) },
      permissions,
    };
  }

  async createRole(
    data: { name: string; description?: string },
    createdBy: string | null = null,
  ): Promise<ManagedRole> {
    const existing = await this.roleRepository.findOne({
      where: { name: data.name },
      withDeleted: true,
    });
    if (existing) {
      throw new ConflictException(`Role "${data.name}" already exists`);
    }

    return this.roleRepository.save({
      name: data.name,
      description: data.description ?? null,
      isSystem: false,
      isActive: true,
      createdBy,
    });
  }

  async listRoles(): Promise<ManagedRole[]> {
    return this.roleRepository.find();
  }

  async getRole(roleId: string): Promise<ManagedRole> {
    const role = await this.roleRepository.findOne({ where: { id: roleId } });
    if (!role) throw new NotFoundException('Role not found');
    return role;
  }

  async updateRole(roleId: string, data: UpdateRoleDto): Promise<ManagedRole> {
    const role = await this.getRole(roleId);
    if (role.isSystem) {
      throw new ConflictException('System roles cannot be modified');
    }
    Object.assign(role, data);
    return this.roleRepository.save(role);
  }

  async deleteRole(roleId: string): Promise<void> {
    const role = await this.getRole(roleId);
    if (role.isSystem) {
      throw new ConflictException('System roles cannot be deleted');
    }
    // Soft delete keeps the row, but assignments must go: the FK CASCADE only
    // fires on hard deletes, and ghost assignments used to crash every
    // permission check for the affected users.
    await this.userRoleRepository.delete({ roleId });
    await this.roleRepository.softDelete(roleId);
  }

  async setRolePermissions(
    roleId: string,
    permissionIds: string[],
  ): Promise<void> {
    const role = await this.getRole(roleId);
    if (role.isSystem) {
      throw new ConflictException('System roles cannot be modified');
    }

    const uniqueIds = [...new Set(permissionIds)];
    if (uniqueIds.length > 0) {
      const found = await this.permissionRepository.count({
        where: { id: In(uniqueIds) },
      });
      if (found !== uniqueIds.length) {
        throw new NotFoundException('One or more permissions were not found');
      }
    }

    await this.rolePermissionRepository.delete({ roleId });
    if (uniqueIds.length > 0) {
      await this.rolePermissionRepository.save(
        uniqueIds.map((permissionId) => ({ roleId, permissionId })),
      );
    }
  }

  async listPermissions(): Promise<Permission[]> {
    return this.permissionRepository.find({ where: { isActive: true } });
  }

  async getRolePermissionIds(roleId: string): Promise<string[]> {
    const rows = await this.rolePermissionRepository.find({
      where: { roleId },
    });
    return rows.map((rp) => rp.permissionId);
  }

  async getPermissionIdsByRoleIds(
    roleIds: string[],
  ): Promise<Record<string, string[]>> {
    const result: Record<string, string[]> = {};
    if (roleIds.length === 0) return result;
    const rows = await this.rolePermissionRepository.find({
      where: { roleId: In(roleIds) },
    });
    for (const rp of rows) {
      (result[rp.roleId] ??= []).push(rp.permissionId);
    }
    return result;
  }

  async getUserRoleIds(userId: string): Promise<string[]> {
    const roles = await this.getUserRoles(userId);
    return roles.map((role) => role.id);
  }

  async setUserRoles(
    userId: string,
    roleIds: string[],
    assignedBy: string | null,
  ): Promise<void> {
    const uniqueRoleIds = [...new Set(roleIds)];

    if (uniqueRoleIds.length > 0) {
      const found = await this.roleRepository.count({
        where: { id: In(uniqueRoleIds) },
      });
      if (found !== uniqueRoleIds.length) {
        throw new NotFoundException('One or more roles were not found');
      }
    }

    await this.userRoleRepository.delete({ userId });

    if (uniqueRoleIds.length > 0) {
      const entities = uniqueRoleIds.map((roleId) => ({
        userId,
        roleId,
        assignedBy,
      }));
      await this.userRoleRepository.save(entities);
    }
  }
}
