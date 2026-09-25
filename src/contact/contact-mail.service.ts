import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { StorefrontConfig, SupportConfig } from '../config/configuration';
import { EmailStatus } from '../mail/entities/email-log.entity';
import { MailService } from '../mail/mail.service';
import { contactReply } from '../mail/templates';

/**
 * Respuestas a los mensajes de contacto.
 *
 * Sigue siendo cerrado por defecto: sin `RESEND_API_KEY` + `RESEND_FROM` el
 * envío responde 503 y el botón del admin está deshabilitado, porque dar por
 * respondido un mensaje que nunca salió es peor que no poder responder.
 * La diferencia con antes es que, configurado, ahora sale de verdad.
 */
@Injectable()
export class ContactMailService {
  constructor(
    private readonly mail: MailService,
    private readonly configService: ConfigService,
  ) {}

  get configured(): boolean {
    return this.mail.configured;
  }

  async sendReply(to: string, subject: string, body: string): Promise<void> {
    if (!this.configured) {
      throw new ServiceUnavailableException(
        'RESEND_API_KEY is not configured; platform replies are disabled',
      );
    }
    const { html, text } = contactReply({
      body,
      storeUrl:
        this.configService.get<StorefrontConfig>('storefront')?.url ?? null,
      whatsapp:
        this.configService.get<SupportConfig>('support')?.whatsapp ?? '',
    });
    const result = await this.mail.send({
      to,
      subject,
      text,
      html,
      template: 'contact_reply',
    });
    if (result.status !== EmailStatus.SENT) {
      // Que falle el envío no puede quedar como respondido: el error sube y
      // el mensaje se queda en la bandeja.
      throw new ServiceUnavailableException(
        `No se pudo enviar la respuesta: ${result.error ?? 'error desconocido'}`,
      );
    }
  }
}
