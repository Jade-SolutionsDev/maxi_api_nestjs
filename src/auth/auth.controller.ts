import { Controller, Get, Request, UseGuards } from '@nestjs/common';
import { UserResponseDto } from '../users/dto/user-response.dto';
import type { AuthenticatedUserRequest } from './types/authenticated-request';
import { ClerkUserAuthGuard } from './guards/clerk-user-auth.guard';

@Controller('auth')
export class AuthController {
  @Get('me')
  @UseGuards(ClerkUserAuthGuard)
  me(@Request() req: AuthenticatedUserRequest) {
    return UserResponseDto.fromEntity(req.user);
  }
}
