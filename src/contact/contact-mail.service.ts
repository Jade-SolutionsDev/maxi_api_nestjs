import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ResendConfig } from '../config/configuration';

/**
 * Platform email replies, drafted ahead of the Resend integration and
 * FAIL-CLOSED until it lands: without RESEND_API_KEY + RESEND_FROM the send
 * refuses with a 503 (same posture as the payment gateways and the cron
 * secret). The admin UI reads `configured` and keeps its button disabled, so
 * this exception is the backstop, not the UX.
 */
@Injectable()
export class ContactMailService {
  constructor(private readonly configService: ConfigService) {}

  get configured(): boolean {
    return this.configService.get<ResendConfig>('resend')?.configured ?? false;
  }

  sendReply(to: string, subject: string, body: string): Promise<void> {
    if (!this.configured) {
      throw new ServiceUnavailableException(
        'RESEND_API_KEY is not configured; platform replies are disabled',
      );
    }
    // TODO(resend): POST https://api.resend.com/emails with
    // { from: resend.fromAddress, to, subject, text: body } once the Resend
    // account exists. Until then `configured` is always false and this line
    // is unreachable.
    void to;
    void subject;
    void body;
    throw new ServiceUnavailableException(
      'Platform replies are not integrated yet',
    );
  }
}
