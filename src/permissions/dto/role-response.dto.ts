import { ManagedRole } from '../entities/role.entity';

export class RoleResponseDto {
  id: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  /**
   * Marca los roles semilla editables («Almacenero — base», «Kardista — base»,
   * «Responsable de la web — base»): existe en la entidad desde
   * `RbacManagedCatalog` pero no se exponía, así que el panel no podía
   * distinguirlos de los creados a mano y su columna «Tipo» decía
   * «Personalizado» para todos. La diferencia solo vivía pegada al nombre como
   * sufijo «— base», que es lo que QA encontró confuso (MxH-0103).
   */
  systemKey: string | null;
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
    dto.systemKey = role.systemKey;
    dto.isActive = role.isActive;
    dto.createdBy = role.createdBy;
    dto.createdAt = role.createdAt;
    dto.updatedAt = role.updatedAt;
    dto.permissionIds = permissionIds;
    return dto;
  }
}
