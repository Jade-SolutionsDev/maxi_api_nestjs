import {
  ConflictException,
  Injectable,
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

/** Modules whose actions are governed by managed permissions this stage. */
export const MODULES = [
  'products',
  'categories',
  'departments',
  'stock-locations',
] as const;
export const ACTIONS = ['list', 'read', 'create', 'update', 'delete'] as const;

const READ: readonly string[] = ['list', 'read'];

/**
 * Baseline access the enum roles keep even with no managed role assigned —
 * mirrors the `@Roles(...)` gating the catalog controllers had before. Managed
 * roles only ever ADD on top of this, so switching to permission checks never
 * removes access an existing GROCER/KARDIST already had. Admins bypass entirely.
 */
const DEFAULT_ROLE_PERMISSIONS: Record<
  string,
  Record<string, readonly string[]>
> = {
  // GROCER: full control of products + read-only taxonomy, and manage their
  // assigned storages — list/read/update but not create/delete (today's @Roles).
  [Role.GROCER]: {
    products: ACTIONS,
    categories: READ,
    departments: READ,
    'stock-locations': ['list', 'read', 'update'],
  },
  // KARDIST: read-only taxonomy, no product/storage access (today's @Roles).
  [Role.KARDIST]: { categories: READ, departments: READ },
};

/** System-admin tiers bypass all permission checks. */
const isSystemAdmin = (role: string | null): boolean =>
  (role as Role) === Role.SUPER_ADMIN || (role as Role) === Role.ADMIN;

@Injectable()
export class PermissionsService implements OnModuleInit {
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
  }

  /** Seed the permission catalog (modules × actions) for enforced modules. */
  private async seedPermissions(): Promise<void> {
    for (const module of MODULES) {
      for (const action of ACTIONS) {
        const existing = await this.permissionRepository.findOne({
          where: { module, action },
        });
        if (!existing) {
          await this.permissionRepository.save({
            module,
            action,
            description: `${action} ${module}`,
            isActive: true,
          });
        }
      }
    }
  }

  private baselineGrants(
    role: string,
    module: string,
    action: string,
  ): boolean {
    return DEFAULT_ROLE_PERMISSIONS[role]?.[module]?.includes(action) ?? false;
  }

  /**
   * Effective check: system admins bypass, then the enum baseline, then any
   * assigned managed role.
   */
  async hasPermission(
    userId: string,
    role: string,
    module: string,
    action: string,
  ): Promise<boolean> {
    if (isSystemAdmin(role)) return true;
    if (this.baselineGrants(role, module, action)) return true;

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
    return userRoles
      .filter((ur) => ur.role.isActive && ur.role.deletedAt === null)
      .map((ur) => ur.roleId);
  }

  async getUserRoles(userId: string): Promise<ManagedRole[]> {
    const userRoles = await this.userRoleRepository.find({
      where: { userId },
      relations: { role: true },
    });
    return userRoles
      .map((ur) => ur.role)
      .filter((role) => role.isActive && role.deletedAt === null);
  }

  /**
   * The effective permission map for a user (baseline ∪ managed, or everything
   * for admins) — consumed by the frontend to gate UI actions.
   */
  async getUserPermissions(userId: string): Promise<UserPermissionsPayload> {
    const permissions: Record<string, string[]> = {};
    const add = (module: string, action: string) => {
      (permissions[module] ??= []).push(action);
    };

    const user = await this.userRepository.findOne({ where: { id: userId } });
    const role: string | null = user?.role ?? null;

    if (isSystemAdmin(role)) {
      for (const module of MODULES) permissions[module] = [...ACTIONS];
      return { user: { id: userId, role, roles: [] }, permissions };
    }

    // Baseline from the enum role.
    const baseline = role ? DEFAULT_ROLE_PERMISSIONS[role] : undefined;
    if (baseline) {
      for (const [module, actions] of Object.entries(baseline)) {
        for (const action of actions) add(module, action);
      }
    }

    // Managed roles add on top.
    const roles = await this.getUserRoles(userId);
    if (roles.length > 0) {
      const rolePermissions = await this.rolePermissionRepository.find({
        where: { roleId: In(roles.map((r) => r.id)) },
        relations: { permission: true },
      });
      for (const rp of rolePermissions) {
        const perm = rp.permission;
        if (!perm.isActive) continue;
        if (!permissions[perm.module]?.includes(perm.action)) {
          add(perm.module, perm.action);
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
    await this.rolePermissionRepository.delete({ roleId });
    if (permissionIds.length > 0) {
      const entities = permissionIds.map((permissionId) => ({
        roleId,
        permissionId,
      }));
      await this.rolePermissionRepository.save(entities);
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
