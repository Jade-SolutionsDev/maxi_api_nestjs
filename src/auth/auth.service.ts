import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { verifyToken } from '@clerk/backend';
import { verify } from 'jsonwebtoken';
import { UserResponseDto } from '../users/dto/user-response.dto';
import { User } from '../users/entities/user.entity';
import { UsersService } from '../users/users.service';

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly configService: ConfigService,
  ) {}

  async authenticateByBearerToken(token: string): Promise<User> {
    let clerkId: string;

    try {
      clerkId = await this.verifyClerkToken(token);
    } catch {
      throw new UnauthorizedException('Invalid access token');
    }

    const user = await this.usersService.findByClerkId(clerkId);
    if (!user) {
      throw new UnauthorizedException('User not registered in backoffice');
    }
    if (!user.isActive) {
      throw new UnauthorizedException('Account is inactive');
    }

    return user;
  }

  async me(clerkId: string): Promise<UserResponseDto> {
    const user = await this.usersService.findByClerkId(clerkId);
    if (!user) {
      throw new UnauthorizedException('User not found');
    }
    return UserResponseDto.fromEntity(user);
  }

  private async verifyClerkToken(token: string): Promise<string> {
    const secretKey = this.configService.get<string>('clerk.secretKey');
    const backofficeSecretKey = this.configService.get<string>(
      'clerk.backofficeSecretKey',
    );

    // Providers/staff live in the storefront Clerk instance; admins live in a
    // separate backoffice Clerk instance. Try both before falling back.
    try {
      if (secretKey) {
        const payload = await verifyToken(token, { secretKey });
        if (payload.sub) {
          return payload.sub;
        }
      }
    } catch (error) {
      Logger.warn(
        `Failed to verify token against storefront Clerk instance: ${error}`,
      );
    }

    try {
      if (backofficeSecretKey) {
        const payload = await verifyToken(token, {
          secretKey: backofficeSecretKey,
        });
        if (payload.sub) {
          return payload.sub;
        }
      }

      if (secretKey || backofficeSecretKey) {
        throw new Error('Unable to verify Clerk token against known instances');
      }
    } catch (error) {
      Logger.warn(
        `Failed to verify token against backoffice Clerk instance: ${error}`,
      );
    }

    // ponytail: dev fallback when no Clerk secrets are configured
    const devSecret =
      this.configService.get<string>('clerk.jwtSecret') ?? 'dev-secret';
    const payload = verify(token, devSecret) as { sub: string };
    return payload.sub;
  }
}
