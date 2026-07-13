import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Req,
} from '@nestjs/common';
import type { AuthenticatedUserRequest } from '../auth/types/authenticated-request';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../users/entities/user.entity';
import { CreateRoleDto } from './dto/create-role.dto';
import { RoleResponseDto } from './dto/role-response.dto';
import { SetRolePermissionsDto } from './dto/set-role-permissions.dto';
import { SetUserRolesDto } from './dto/set-user-roles.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { Permission } from './entities/permission.entity';
import { ManagedRole } from './entities/role.entity';
import {
  PermissionsService,
  UserPermissionsPayload,
} from './permissions.service';

// Managing roles/permissions is a system-admin surface. Global AuthGuard
// authenticates; RolesGuard enforces the tier.
@Controller('permissions')
@Roles(Role.SUPER_ADMIN, Role.ADMIN)
export class PermissionsController {
  constructor(private readonly permissionsService: PermissionsService) {}

  @Get()
  async listPermissions(): Promise<Permission[]> {
    return this.permissionsService.listPermissions();
  }

  @Post('roles')
  async createRole(
    @Body() dto: CreateRoleDto,
    @Req() request: AuthenticatedUserRequest,
  ): Promise<RoleResponseDto> {
    const role = await this.permissionsService.createRole(dto, request.user.id);
    return RoleResponseDto.fromEntity(role, []);
  }

  @Get('roles')
  async listRoles(): Promise<RoleResponseDto[]> {
    const roles = await this.permissionsService.listRoles();
    const permissionIdsByRole =
      await this.permissionsService.getPermissionIdsByRoleIds(
        roles.map((role) => role.id),
      );
    return roles.map((role) =>
      RoleResponseDto.fromEntity(role, permissionIdsByRole[role.id] ?? []),
    );
  }

  @Get('roles/:id')
  async getRole(@Param('id') id: string): Promise<RoleResponseDto> {
    const role = await this.permissionsService.getRole(id);
    const permissionIds =
      await this.permissionsService.getRolePermissionIds(id);
    return RoleResponseDto.fromEntity(role, permissionIds);
  }

  @Patch('roles/:id')
  async updateRole(
    @Param('id') id: string,
    @Body() dto: UpdateRoleDto,
  ): Promise<RoleResponseDto> {
    const role = await this.permissionsService.updateRole(id, dto);
    const permissionIds =
      await this.permissionsService.getRolePermissionIds(id);
    return RoleResponseDto.fromEntity(role, permissionIds);
  }

  @Delete('roles/:id')
  async deleteRole(@Param('id') id: string): Promise<void> {
    return this.permissionsService.deleteRole(id);
  }

  @Put('roles/:id/permissions')
  async setRolePermissions(
    @Param('id') id: string,
    @Body() dto: SetRolePermissionsDto,
  ): Promise<RoleResponseDto> {
    const role = await this.permissionsService.getRole(id);
    if (role.isSystem) {
      throw new ForbiddenException(
        'System roles cannot have their permissions modified',
      );
    }
    await this.permissionsService.setRolePermissions(id, dto.permissionIds);
    const permissionIds =
      await this.permissionsService.getRolePermissionIds(id);
    return RoleResponseDto.fromEntity(role, permissionIds);
  }

  @Get('users/:userId/roles')
  async getUserRoles(@Param('userId') userId: string): Promise<ManagedRole[]> {
    return this.permissionsService.getUserRoles(userId);
  }

  @Put('users/:userId/roles')
  async setUserRoles(
    @Param('userId') userId: string,
    @Body() dto: SetUserRolesDto,
    @Req() request: AuthenticatedUserRequest,
  ): Promise<void> {
    return this.permissionsService.setUserRoles(
      userId,
      dto.roleIds,
      request.user.id,
    );
  }

  @Get('users/:userId')
  async getUserPermissions(
    @Param('userId') userId: string,
  ): Promise<UserPermissionsPayload> {
    return this.permissionsService.getUserPermissions(userId);
  }
}
