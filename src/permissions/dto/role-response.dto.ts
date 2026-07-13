import { ManagedRole } from '../entities/role.entity';

export class RoleResponseDto {
  id: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  isActive: boolean;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
  permissionIds: string[];

  static fromEntity(
    role: ManagedRole,
    permissionIds: string[] = [],
  ): RoleResponseDto {
    const dto = new RoleResponseDto();
    dto.id = role.id;
    dto.name = role.name;
    dto.description = role.description;
    dto.isSystem = role.isSystem;
    dto.isActive = role.isActive;
    dto.createdBy = role.createdBy;
    dto.createdAt = role.createdAt;
    dto.updatedAt = role.updatedAt;
    dto.permissionIds = permissionIds;
    return dto;
  }
}
