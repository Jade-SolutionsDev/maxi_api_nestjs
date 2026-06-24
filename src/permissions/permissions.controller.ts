import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { AssignRoleDto } from './dto/assign-role.dto';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { Permission } from './entities/permission.entity';
import { Role } from './entities/role.entity';
import {
  PermissionsService,
  UserPermissionsPayload,
} from './permissions.service';

@Controller('permissions')
export class PermissionsController {
  constructor(private readonly permissionsService: PermissionsService) {}

  @Get()
  async listPermissions(): Promise<Permission[]> {
    return this.permissionsService.listPermissions();
  }

  @Post('roles')
  async createRole(@Body() dto: CreateRoleDto): Promise<Role> {
    return this.permissionsService.createRole(dto);
  }

  @Get('roles')
  async listRoles(): Promise<Role[]> {
    return this.permissionsService.listRoles();
  }

  @Get('roles/:id')
  async getRole(@Param('id') id: string): Promise<Role> {
    return this.permissionsService.getRole(id);
  }

  @Patch('roles/:id')
  async updateRole(
    @Param('id') id: string,
    @Body() dto: UpdateRoleDto,
  ): Promise<Role> {
    return this.permissionsService.updateRole(id, dto);
  }

  @Delete('roles/:id')
  async deleteRole(@Param('id') id: string): Promise<void> {
    return this.permissionsService.deleteRole(id);
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

  @Post('users/:userId/roles/:roleId')
  async assignRole(
    @Param('userId') userId: string,
    @Param('roleId') roleId: string,
    @Body() dto: AssignRoleDto,
  ): Promise<void> {
    return this.permissionsService.assignRoleToUser(
      userId,
      roleId,
      dto.assignedBy,
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
    // ponytail: userType looked up from roles; admin assumed for demo endpoint
    return this.permissionsService.getUserPermissions(userId, 'admin');
  }
}
