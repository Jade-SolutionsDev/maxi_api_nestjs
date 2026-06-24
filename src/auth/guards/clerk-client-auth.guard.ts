import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ClientAuthService } from '../client-auth.service';
import { AuthenticatedClientRequest } from '../types/authenticated-request';

@Injectable()
export class ClerkClientAuthGuard implements CanActivate {
  constructor(private readonly clientAuthService: ClientAuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<AuthenticatedClientRequest>();
    const token = this.extractTokenFromHeader(request);

    if (!token) {
      throw new UnauthorizedException('Missing access token');
    }

    request.client =
      await this.clientAuthService.authenticateByBearerToken(token);
    return true;
  }

  private extractTokenFromHeader(
    request: AuthenticatedClientRequest,
  ): string | undefined {
    const [type, token] = request.headers.authorization?.split(' ') ?? [];
    return type === 'Bearer' ? token : undefined;
  }
}
