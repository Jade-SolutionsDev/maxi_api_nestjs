import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { AuthenticatedUserRequest } from '../../auth/types/authenticated-request';
import { Role } from '../../users/entities/user.entity';

@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context
      .switchToHttp()
      .getRequest<AuthenticatedUserRequest>();

    const isAdmin =
      request.user &&
      (request.user.role === Role.ADMIN ||
        request.user.role === Role.SUPER_ADMIN);
    if (!isAdmin) {
      throw new ForbiddenException('Admin access required');
    }

    return true;
  }
}
