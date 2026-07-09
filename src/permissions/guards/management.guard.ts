import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { AuthenticatedUserRequest } from '../../auth/types/authenticated-request';
import { Role } from '../../users/entities/user.entity';

@Injectable()
export class ManagementGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context
      .switchToHttp()
      .getRequest<AuthenticatedUserRequest>();

    const allowed = [Role.SUPER_ADMIN, Role.ADMIN, Role.GROCER, Role.KARDIST];
    if (!request.user || !allowed.includes(request.user.role)) {
      throw new ForbiddenException('Management access required');
    }

    return true;
  }
}
