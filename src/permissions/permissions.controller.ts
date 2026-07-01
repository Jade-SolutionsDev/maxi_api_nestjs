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
  UseGuards,
} from '@nestjs/common';
import type { AuthenticatedUserRequest } from '../auth/types/authenticated-request';
import { ClerkUserAuthGuard } from '../auth/guards/clerk-user-auth.guard';
import { AdminGuard } from './guards/admin.guard';
import { CreateRoleDto } from './dto/create-role.dto';
import { RoleResponseDto } from './dto/role-response.dto';
import { SetRolePermissionsDto } from './dto/set-role-permissions.dto';
import { SetUserRolesDto } from './dto/set-user-roles.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { Permission } from './entities/permission.entity';
import { Role } from './entities/role.entity';
import {
  PermissionsService,
  UserPermissionsPayload,
} from './permissions.service';

@Controller('permissions')
@UseGuards(ClerkUserAuthGuard, AdminGuard)
export class PermissionsController {
  constructor(private readonly permissionsService: PermissionsService) {}

  @Get()
  async listPermissions(): Promise<Permission[]> {
    return this.permissionsService.listPermissions();
  }

  @Post('roles')
  async createRole(@Body() dto: CreateRoleDto): Promise<RoleResponseDto> {
    const role = await this.permissionsService.createRole(dto);
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

  @Post('roles/:roleId/permissions/:permissionId')
  async assignPermission(
    @Param('roleId') roleId: string,
    @Param('permissionId') permissionId: string,
  ): Promise<void> {
    return this.permissionsService.assignPermissionToRole(roleId, permissionId);
  }

  @Delete('roles/:roleId/permissions/:permissionId')
  async removePermission(
    @Param('roleId') roleId: string,
    @Param('permissionId') permissionId: string,
  ): Promise<void> {
    return this.permissionsService.removePermissionFromRole(
      roleId,
      permissionId,
    );
  }

  @Get('users/:userId/roles')
  async getUserRoles(@Param('userId') userId: string): Promise<Role[]> {
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

  @Post('users/:userId/roles/:roleId')
  async assignRole(
    @Param('userId') userId: string,
    @Param('roleId') roleId: string,
    @Req() request: AuthenticatedUserRequest,
  ): Promise<void> {
    return this.permissionsService.assignRoleToUser(
      userId,
      roleId,
      request.user.id,
    );
  }

  @Delete('users/:userId/roles/:roleId')
  async removeRole(
    @Param('userId') userId: string,
    @Param('roleId') roleId: string,
  ): Promise<void> {
    return this.permissionsService.removeRoleFromUser(userId, roleId);
  }

  @Get('users/:userId')
  async getUserPermissions(
    @Param('userId') userId: string,
  ): Promise<UserPermissionsPayload> {
    return this.permissionsService.getUserPermissions(userId);
  }
}
