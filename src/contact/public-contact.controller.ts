import {
  Body,
  Controller,
  Get,
  Header,
  Headers,
  HttpCode,
  Post,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ClientAuthService } from '../auth/client-auth.service';
import { Client } from '../clients/entities/client.entity';
import { TAXONOMY_CACHE } from '../common/constants/cache-control';
import { Public } from '../common/decorators/public.decorator';
import { StrictThrottle } from '../common/throttle';
import { NomenclatorResponseDto } from '../nomenclators/dto/nomenclator.dto';
import { NomenclatorsService } from '../nomenclators/nomenclators.service';
import { CONTACT_MOTIVE_CATEGORY, ContactService } from './contact.service';
import { CreateContactMessageDto } from './dto/contact-message.dto';

// Unauthenticated storefront surface. The submit endpoint OPTIONALLY
// identifies a signed-in customer: there is no optional client guard, so the
// bearer token — when present — is verified by hand and a failure simply
// falls back to the anonymous path (the form works logged out).
@ApiTags('storefront')
@Controller('public/contact')
@Public()
export class PublicContactController {
  constructor(
    private readonly contactService: ContactService,
    private readonly nomenclatorsService: NomenclatorsService,
    private readonly clientAuthService: ClientAuthService,
  ) {}

  @Get('motives')
  @Header('Cache-Control', TAXONOMY_CACHE)
  @ApiOperation({ summary: 'Active contact motives, in display order' })
  async motives(): Promise<NomenclatorResponseDto[]> {
    const rows = await this.nomenclatorsService.listActive(
      CONTACT_MOTIVE_CATEGORY,
    );
    return rows.map(NomenclatorResponseDto.fromEntity);
  }

  @Post('messages')
  @HttpCode(201)
  @StrictThrottle()
  @ApiOperation({
    summary: 'Submit a contact message (anonymous or signed-in)',
    description:
      'With a valid Clerk bearer token the sender identity is snapshotted ' +
      'from the customer account and body identity fields are ignored. ' +
      'Anonymous senders must provide name, last name and an email or a ' +
      'phone number. Bot submissions (honeypot) are silently discarded.',
  })
  async submit(
    @Body() dto: CreateContactMessageDto,
    @Headers('authorization') authorization?: string,
  ): Promise<{ received: true }> {
    let client: Client | null = null;
    const token = authorization?.replace(/^Bearer\s+/i, '');
    if (token) {
      try {
        client = await this.clientAuthService.authenticateByBearerToken(token);
      } catch {
        client = null;
      }
    }

    await this.contactService.submitMessage(dto, client);
    return { received: true };
  }
}
