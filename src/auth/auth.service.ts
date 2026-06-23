import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { sign, SignOptions } from 'jsonwebtoken';
import { comparePassword } from '../common/helpers/password.helper';
import { UserResponseDto } from '../users/dto/user-response.dto';
import { UsersService } from '../users/users.service';
import { LoginDto } from './dto/login.dto';

export interface LoginResult {
  accessToken: string;
  user: UserResponseDto;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly configService: ConfigService,
  ) {}

  async login(loginDto: LoginDto): Promise<LoginResult> {
    const user = await this.usersService.findByEmail(loginDto.email);

    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const isPasswordValid = await comparePassword(
      loginDto.password,
      user.passwordHash,
    );

    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const payload = {
      sub: user.id,
      email: user.email,
      userType: user.userType,
      status: user.status,
    };

    const secret = this.configService.get<string>('jwt.secret') ?? 'dev-secret';
    const expiresIn = this.configService.get<string>('jwt.expiresIn') ?? '1d';

    const accessToken = sign(payload, secret, {
      expiresIn,
    } as SignOptions);

    return {
      accessToken,
      user: UserResponseDto.fromEntity(user),
    };
  }
}
