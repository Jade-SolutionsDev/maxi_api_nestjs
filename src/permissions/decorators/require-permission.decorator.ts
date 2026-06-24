import { Reflector } from '@nestjs/core';

export interface PermissionRequirement {
  module: string;
  action: string;
}

export const RequirePermission =
  Reflector.createDecorator<PermissionRequirement>();

export const PERMISSION_KEY = RequirePermission.KEY;
