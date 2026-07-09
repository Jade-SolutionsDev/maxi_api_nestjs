import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { AuthenticatedUserRequest } from '../../auth/types/authenticated-request';
import { Role } from '../../users/entities/user.entity';

@Injectable()
export class ProviderGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context
      .switchToHttp()
      .getRequest<AuthenticatedUserRequest>();

    if (!request.user || request.user.role !== Role.GROCER) {
      throw new ForbiddenException('Provider access required');
    }

    return true;
  }
}
