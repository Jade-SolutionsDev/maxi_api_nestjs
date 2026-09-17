import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { EmailStatus } from '../mail/entities/email-log.entity';
import { MailService } from '../mail/mail.service';

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
  constructor(private readonly mail: MailService) {}

  get configured(): boolean {
    return this.mail.configured;
  }

  async sendReply(to: string, subject: string, body: string): Promise<void> {
    if (!this.configured) {
      throw new ServiceUnavailableException(
        'RESEND_API_KEY is not configured; platform replies are disabled',
      );
    }
    const result = await this.mail.send({
      to,
      subject,
      text: body,
      html: this.asHtml(body),
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

  /** El cuerpo lo escribe una persona en texto plano; se respetan sus saltos. */
  private asHtml(body: string): string {
    const escaped = body
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    return `<div style="font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#1c1917;white-space:pre-wrap;">${escaped}</div>`;
  }
}
