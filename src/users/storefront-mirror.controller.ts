import {
  Body,
  Controller,
  Headers,
  HttpCode,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Public } from '../common/decorators/public.decorator';
import { StrictThrottle } from '../common/throttle';
import { CustomerProvisioningService } from '../clients/customer-provisioning.service';
import { StorefrontMirrorDto } from './dto/storefront-mirror.dto';

/**
 * Public endpoint called by the invitation sign-up page right after the admin
 * account is created in backoffice Clerk. It provisions a matching, DISABLED
 * storefront customer with the SAME email + password (the only moment the
 * password is available). The password is forwarded to Clerk and never stored.
 *
 * Access control: the caller must present the backoffice Clerk session token of
 * the just-created admin, and it must belong to the email being mirrored. This
 * proves the caller IS the invitee — closing the invitation-enumeration oracle
 * and the attacker-chosen-password pre-claim. Rejections are uniform, so a
 * caller cannot tell an invited email from a non-invited one.
 *
 * Separate controller from UsersController because that class is `@Roles(...)`
 * gated — a `@Public()` route there would still be rejected by RolesGuard.
 */
@Public()
@ApiTags('users')
@Controller('users')
export class StorefrontMirrorController {
  constructor(private readonly provisioning: CustomerProvisioningService) {}

  @Post('storefront-mirror')
  @HttpCode(200)
  @StrictThrottle()
  async mirror(
    @Body() dto: StorefrontMirrorDto,
    @Headers('authorization') authorization?: string,
  ): Promise<{ ok: boolean }> {
    const [scheme, token] = authorization?.split(' ') ?? [];
    const bearer = scheme === 'Bearer' ? token : undefined;

    const authorized =
      !!bearer && (await this.provisioning.tokenOwnsEmail(bearer, dto.email));
    if (!authorized) {
      throw new UnauthorizedException('Invalid or mismatched credentials');
    }

    await this.provisioning.provisionPending({
      email: dto.email,
      password: dto.password,
      firstName: dto.firstName,
      lastName: dto.lastName,
      phone: dto.phone,
    });
    return { ok: true };
  }
}
