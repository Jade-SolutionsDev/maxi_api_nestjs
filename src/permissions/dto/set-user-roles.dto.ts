import { IsArray, IsUUID } from 'class-validator';

export class SetUserRolesDto {
  @IsArray()
  @IsUUID('all', { each: true })
  roleIds: string[];
}
