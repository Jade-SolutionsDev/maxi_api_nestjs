import { IsArray, IsUUID } from 'class-validator';

export class SetRolePermissionsDto {
  @IsArray()
  @IsUUID('all', { each: true })
  permissionIds: string[];
}
