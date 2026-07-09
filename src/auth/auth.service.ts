import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { UserResponseDto } from '../users/dto/user-response.dto';
import { User } from '../users/entities/user.entity';
import { UsersService } from '../users/users.service';
import {
  AUTH_PROVIDER,
  AuthProvider,
} from './interfaces/auth-provider.interface';

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    @Inject(AUTH_PROVIDER) private readonly authProvider: AuthProvider,
  ) {}

  async authenticateByBearerToken(token: string): Promise<User> {
    let clerkId: string;

    try {
      clerkId = (await this.authProvider.verifyToken(token)).sub;
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
}
