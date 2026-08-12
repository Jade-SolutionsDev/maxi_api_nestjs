import {
  BadRequestException,
  Controller,
  HttpCode,
  Post,
  Req,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { Public } from '../../common/decorators/public.decorator';
import { MibiPaymentService } from './mibi-payment.service';

interface RequestWithRawBody extends Request {
  rawBody?: string;
}

// Signed gateway callbacks. @Public() — authentication is the HMAC signature
// over the raw body (captured globally in main.ts), same pattern as the Clerk
// webhooks. Fast 200 always; processing failures are logged, not retried into.
@ApiTags('webhooks')
@Controller('webhooks/mibilletera')
@Public()
export class MibiWebhookController {
  constructor(private readonly mibiPaymentService: MibiPaymentService) {}

  @Post()
  @HttpCode(200)
  @ApiOperation({
    summary: 'Mi Billetera charge webhook (HMAC-signed)',
    description:
      'Receives charge.succeeded/failed/expired/cancelled events. The body ' +
      'is verified against X-Mibi-Signature (HMAC-SHA256 of the raw body). ' +
      'Processing is idempotent; polling remains the authoritative fallback.',
  })
  async handle(
    @Req() request: RequestWithRawBody,
  ): Promise<{ processed: boolean }> {
    const rawBody = request.rawBody;
    if (!rawBody) {
      throw new BadRequestException(
        'Missing raw body for webhook verification',
      );
    }
    return this.mibiPaymentService.handleWebhook(rawBody, request.headers);
  }
}
