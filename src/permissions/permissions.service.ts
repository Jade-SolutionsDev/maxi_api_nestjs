import {
  ConflictException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { UpdateRoleDto } from './dto/update-role.dto';
import { Permission } from './entities/permission.entity';
import { Role } from './entities/role.entity';
import { RolePermission } from './entities/role-permission.entity';
import { UserRole } from './entities/user-role.entity';

export interface PermissionRef {
  module: string;
  action: string;
}

export interface UserPermissionsPayload {
  user: {
    id: string;
    userType: string;
    roles: string[];
  };
  permissions: Record<string, string[]>;
}

const SYSTEM_MODULES = [
  'products',
  'categories',
  'orders',
  'providers',
  'clients',
  'coverage',
  'locations',
  'team',
  'roles',
  'analytics',
  'settings',
  'users',
] as const;

const ACTIONS = ['create', 'read', 'update', 'delete', 'list'] as const;

@Injectable()
export class PermissionsService implements OnModuleInit {
  constructor(
    @InjectRepository(Permission)
    private readonly permissionRepository: Repository<Permission>,
    @InjectRepository(Role)
    private readonly roleRepository: Repository<Role>,
    @InjectRepository(RolePermission)
    private readonly rolePermissionRepository: Repository<RolePermission>,
    @InjectRepository(UserRole)
    private readonly userRoleRepository: Repository<UserRole>,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.seedPermissions();
    await this.seedSystemRoles();
  }

  private async seedPermissions(): Promise<void> {
    for (const module of SYSTEM_MODULES) {
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

  private async seedSystemRoles(): Promise<void> {
    const roles: Array<{
      name: string;
      description: string;
      scopes: string[];
    }> = [
      {
        name: 'Super Administrador',
        description: 'Full platform access',
        scopes: ['*:*'],
      },
      {
        name: 'Proveedor — Dueno',
        description: 'Full control over own business',
        scopes: [
          'products:crud',
          'categories:crud',
          'orders:crud',
          'coverage:crud',
          'team:read',
        ],
      },
      {
        name: 'Proveedor — Gestor',
        description: 'Manage products and orders',
        scopes: ['products:crud', 'categories:crud', 'orders:crud'],
      },
      {
        name: 'Proveedor — Solo Lectura',
        description: 'View products and orders',
        scopes: [
          'products:read',
          'products:list',
          'categories:read',
          'categories:list',
          'orders:read',
          'orders:list',
        ],
      },
      {
        name: 'Analista',
        description: 'Reports only',
        scopes: ['analytics:read', 'analytics:list'],
      },
    ];

    for (const item of roles) {
      let role = await this.roleRepository.findOne({
        where: { name: item.name, isSystem: true },
        withDeleted: true,
      });
      if (!role) {
        role = await this.roleRepository.save({
          name: item.name,
          description: item.description,
          isSystem: true,
          isActive: true,
          createdBy: null,
        });
      }
      await this.setRolePermissionsByScope(role.id, item.scopes);
    }
  }

  private expandScope(scope: string): PermissionRef[] {
    const [module, action] = scope.split(':');
    if (!module || !action) return [];
    if (action === 'crud') {
      return ACTIONS.map((a) => ({ module, action: a }));
    }
    return [{ module, action }];
  }

  private async setRolePermissionsByScope(
    roleId: string,
    scopes: string[],
  ): Promise<void> {
    const permissionIds: string[] = [];
    for (const scope of scopes) {
      if (scope === '*:*') {
        const all = await this.permissionRepository.find();
        permissionIds.push(...all.map((p) => p.id));
        continue;
      }
      const refs = this.expandScope(scope);
      for (const ref of refs) {
        const perm = await this.permissionRepository.findOne({
          where: { module: ref.module, action: ref.action, isActive: true },
        });
        if (perm && !permissionIds.includes(perm.id)) {
          permissionIds.push(perm.id);
        }
      }
    }
    await this.setRolePermissions(roleId, permissionIds);
  }

  async hasPermission(
    userId: string,
    userType: string,
    module: string,
    action: string,
  ): Promise<boolean> {
    if (userType === 'admin') return true;

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

  async hasAnyPermission(
    userId: string,
    userType: string,
    permissions: PermissionRef[],
  ): Promise<boolean> {
    for (const { module, action } of permissions) {
      if (await this.hasPermission(userId, userType, module, action))
        return true;
    }
    return false;
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

  async getUserRoles(userId: string): Promise<Role[]> {
    const userRoles = await this.userRoleRepository.find({
      where: { userId },
      relations: { role: true },
    });
    return userRoles
      .map((ur) => ur.role)
      .filter((role) => role.isActive && role.deletedAt === null);
  }

  async getUserPermissions(
    userId: string,
    userType: string,
  ): Promise<UserPermissionsPayload> {
    const permissions: Record<string, string[]> = {};

    if (userType === 'admin') {
      for (const module of SYSTEM_MODULES) {
        permissions[module] = [...ACTIONS];
      }
      return {
        user: {
          id: userId,
          userType,
          roles: [],
        },
        permissions,
      };
    }

    const roles = await this.getUserRoles(userId);
    if (roles.length > 0) {
      const roleIds = roles.map((r) => r.id);
      const rolePermissions = await this.rolePermissionRepository.find({
        where: { roleId: In(roleIds) },
        relations: { permission: true },
      });
      for (const rp of rolePermissions) {
        const perm = rp.permission;
        if (!perm.isActive) continue;
        permissions[perm.module] ??= [];
        if (!permissions[perm.module].includes(perm.action)) {
          permissions[perm.module].push(perm.action);
        }
      }
    }

    return {
      user: {
        id: userId,
        userType,
        roles: roles.map((r) => r.name),
      },
      permissions,
    };
  }

  async createRole(
    data: { name: string; description?: string },
    createdBy: string | null = null,
  ): Promise<Role> {
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

  async listRoles(): Promise<Role[]> {
    return this.roleRepository.find();
  }

  async getRole(roleId: string): Promise<Role> {
    const role = await this.roleRepository.findOne({ where: { id: roleId } });
    if (!role) throw new NotFoundException('Role not found');
    return role;
  }

  async updateRole(roleId: string, data: UpdateRoleDto): Promise<Role> {
    const role = await this.getRole(roleId);
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

  async assignPermissionToRole(
    roleId: string,
    permissionId: string,
  ): Promise<void> {
    await this.getRole(roleId);
    const permission = await this.permissionRepository.findOne({
      where: { id: permissionId },
    });
    if (!permission) throw new NotFoundException('Permission not found');

    const existing = await this.rolePermissionRepository.findOne({
      where: { roleId, permissionId },
    });
    if (!existing) {
      await this.rolePermissionRepository.save({ roleId, permissionId });
    }
  }

  async removePermissionFromRole(
    roleId: string,
    permissionId: string,
  ): Promise<void> {
    await this.rolePermissionRepository.delete({ roleId, permissionId });
  }

  async setRolePermissions(
    roleId: string,
    permissionIds: string[],
  ): Promise<void> {
    await this.getRole(roleId);
    await this.rolePermissionRepository.delete({ roleId });
    if (permissionIds.length > 0) {
      const entities = permissionIds.map((permissionId) => ({
        roleId,
        permissionId,
      }));
      await this.rolePermissionRepository.save(entities);
    }
  }

  async assignRoleToUser(
    userId: string,
    roleId: string,
    assignedBy: string,
  ): Promise<void> {
    await this.getRole(roleId);
    const existing = await this.userRoleRepository.findOne({
      where: { userId, roleId },
    });
    if (!existing) {
      await this.userRoleRepository.save({ userId, roleId, assignedBy });
    }
  }

  async removeRoleFromUser(userId: string, roleId: string): Promise<void> {
    await this.userRoleRepository.delete({ userId, roleId });
  }

  async listPermissions(): Promise<Permission[]> {
    return this.permissionRepository.find({ where: { isActive: true } });
  }
}
