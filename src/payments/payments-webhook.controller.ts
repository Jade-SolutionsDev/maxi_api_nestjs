import {
  BadRequestException,
  Controller,
  HttpCode,
  Logger,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { Public } from '../common/decorators/public.decorator';
import { PaymentsService } from './payments.service';

interface RequestWithRawBody extends Request {
  rawBody?: string;
}

/**
 * Signed gateway callbacks, one route for every platform. @Public() —
 * authentication is the provider's own signature over the raw body (captured
 * globally in main.ts), same pattern as the Clerk webhooks. Answer 200 fast;
 * a non-200 or a timeout makes gateways retry.
 */
@ApiTags('webhooks')
@Controller('webhooks/payments')
@Public()
export class PaymentsWebhookController {
  private readonly logger = new Logger(PaymentsWebhookController.name);

  constructor(private readonly paymentsService: PaymentsService) {}

  @Post(':provider')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Payment gateway callback (signature-verified)',
    description:
      'Applies a charge event from the named gateway ("tropipay", ' +
      '"mibilletera"). The signature is checked against the raw body before ' +
      'anything is trusted. Processing is idempotent; polling remains the ' +
      'fallback for the moment a customer returns before the callback lands.',
  })
  async handle(
    @Param('provider') provider: string,
    @Req() request: RequestWithRawBody,
  ): Promise<{ processed: boolean }> {
    const rawBody = request.rawBody;
    // Every delivery leaves a trace, accepted or not — a staging webhook that
    // dies on signature or parsing must still be visible in the log.
    this.logger.log(
      `Webhook received for "${provider}" (${rawBody?.length ?? 0} bytes) ` +
        `from ${request.ip ?? 'unknown'}`,
    );
    if (!rawBody) {
      throw new BadRequestException(
        'Missing raw body for webhook verification',
      );
    }
    try {
      const result = await this.paymentsService.handleWebhook(
        provider,
        rawBody,
        request.headers,
      );
      this.logger.log(
        `Webhook for "${provider}" handled: processed=${result.processed}`,
      );
      return result;
    } catch (err) {
      // Body first, then the error: the raw payload is the evidence support
      // will ask for. Signatures and payloads carry no secrets.
      this.logger.error(
        `Webhook for "${provider}" rejected. Body: ${rawBody.slice(0, 2000)}`,
        err instanceof Error ? err.stack : String(err),
      );
      throw err;
    }
  }
}
