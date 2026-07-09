import { Controller, Get } from '@nestjs/common';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { UserResponseDto } from '../users/dto/user-response.dto';
import { User } from '../users/entities/user.entity';

@Controller('auth')
export class AuthController {
  // Authentication is enforced by the global AuthGuard; no @Public() here.
  @Get('me')
  me(@CurrentUser() user: User): UserResponseDto {
    return UserResponseDto.fromEntity(user);
  }
}
