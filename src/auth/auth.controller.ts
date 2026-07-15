import { Controller, Get } from '@nestjs/common';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { UserResponseDto } from '../users/dto/user-response.dto';
import { User } from '../users/entities/user.entity';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PermissionsService } from '../permissions/permissions.service';

/** `/auth/me` also carries the caller's effective permission map so the SPA can
 * gate UI actions without an extra (admin-only) round trip. */
export type MeResponse = UserResponseDto & {
  permissions: Record<string, string[]>;
};

@ApiTags('auth')
@ApiBearerAuth()
@Controller('auth')
export class AuthController {
  constructor(private readonly permissionsService: PermissionsService) {}

  // Authentication is enforced by the global AuthGuard; no @Public() here.
  @Get('me')
  async me(@CurrentUser() user: User): Promise<MeResponse> {
    const { permissions } = await this.permissionsService.getUserPermissions(
      user.id,
    );
    return { ...UserResponseDto.fromEntity(user), permissions };
  }
}
