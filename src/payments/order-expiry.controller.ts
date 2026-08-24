import {
  Controller,
  ForbiddenException,
  Headers,
  HttpCode,
  Post,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiExcludeController } from '@nestjs/swagger';
import { timingSafeEqual } from 'node:crypto';
import { PaymentsConfig } from '../config/configuration';
import { Public } from '../common/decorators/public.decorator';
import { ExpirySweepResult, OrderExpiryService } from './order-expiry.service';

/**
 * Trigger for the scheduled expiry sweep. @Public() because no user is behind
 * it: authentication is the shared secret, the same shape the storefront
 * revalidation hook uses. Kept out of the public API docs — it is infrastructure.
 *
 * Driven by a Dokploy Schedule Job that execs into the running container:
 *   node -e 'fetch("http://127.0.0.1:"+(process.env.PORT||3000)+
 *     "/api/internal/orders/expire",{method:"POST",
 *     headers:{"x-cron-secret":process.env.CRON_SECRET}})
 *     .then(r=>r.text()).then(console.log)'
 */
@ApiExcludeController()
@Controller('internal/orders')
@Public()
export class OrderExpiryController {
  constructor(
    private readonly orderExpiryService: OrderExpiryService,
    private readonly configService: ConfigService,
  ) {}

  @Post('expire')
  @HttpCode(200)
  async expire(
    @Headers('x-cron-secret') provided?: string,
  ): Promise<ExpirySweepResult> {
    this.assertSecret(provided);
    return this.orderExpiryService.sweep();
  }

  // Fail closed: an unset secret disables the route rather than leaving an
  // unauthenticated endpoint that cancels orders.
  private assertSecret(provided?: string): void {
    const expected =
      this.configService.get<PaymentsConfig>('payments')?.expiry.cronSecret;
    if (!expected) {
      throw new ServiceUnavailableException(
        'CRON_SECRET is not configured; the expiry sweep is disabled',
      );
    }
    const a = Buffer.from(provided ?? '');
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new ForbiddenException('Invalid cron secret');
    }
  }
}
