import {
  Body,
  Controller,
  ForbiddenException,
  HttpCode,
  Post,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Public } from '../common/decorators/public.decorator';
import { CustomerProvisioningService } from '../clients/customer-provisioning.service';
import { StorefrontMirrorDto } from './dto/storefront-mirror.dto';
import { InvitationsService } from './invitations.service';

/**
 * Public endpoint called by the invitation sign-up page right after the admin
 * account is created in backoffice Clerk. It provisions a matching, DISABLED
 * storefront customer with the SAME email + password (the only moment the
 * password is available). The password is forwarded to Clerk and never stored.
 *
 * Separate controller from UsersController because that class is `@Roles(...)`
 * gated — a `@Public()` route there would still be rejected by RolesGuard.
 */
@Public()
@ApiTags('users')
@Controller('users')
export class StorefrontMirrorController {
  constructor(
    private readonly invitationsService: InvitationsService,
    private readonly provisioning: CustomerProvisioningService,
  ) {}

  @Post('storefront-mirror')
  @HttpCode(200)
  async mirror(@Body() dto: StorefrontMirrorDto): Promise<{ ok: boolean }> {
    // Anti-abuse: only emails that were actually invited to the backoffice.
    const invited = await this.invitationsService.existsByEmail(dto.email);
    if (!invited) {
      throw new ForbiddenException('No invitation exists for this email');
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
