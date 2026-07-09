import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthenticatedUserRequest } from '../../auth/types/authenticated-request';
import {
  PERMISSION_KEY,
  PermissionRequirement,
} from '../decorators/require-permission.decorator';
import { PermissionsService } from '../permissions.service';

@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly permissionsService: PermissionsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requirement = this.reflector.getAllAndOverride<PermissionRequirement>(
      PERMISSION_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!requirement) {
      return true;
    }

    const request = context
      .switchToHttp()
      .getRequest<AuthenticatedUserRequest>();

    if (!request.user) {
      throw new ForbiddenException('Authentication required');
    }

    const hasPermission = await this.permissionsService.hasPermission(
      request.user.id,
      request.user.role,
      requirement.module,
      requirement.action,
    );

    if (!hasPermission) {
      throw new ForbiddenException('Permission denied');
    }

    return true;
  }
}
