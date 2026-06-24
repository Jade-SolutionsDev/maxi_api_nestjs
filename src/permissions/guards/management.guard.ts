import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { AuthenticatedUserRequest } from '../../auth/types/authenticated-request';
import { UserType } from '../../users/entities/user.entity';

@Injectable()
export class ManagementGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context
      .switchToHttp()
      .getRequest<AuthenticatedUserRequest>();

    const allowed = [UserType.ADMIN, UserType.PROVIDER, UserType.STAFF];
    if (!request.user || !allowed.includes(request.user.userType)) {
      throw new ForbiddenException('Management access required');
    }

    return true;
  }
}
