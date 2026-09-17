import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ResendConfig } from '../config/configuration';
import { EmailLog, EmailStatus } from './entities/email-log.entity';

export interface OutgoingEmail {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Clave de plantilla, para el registro y para no repetir envíos. */
  template: string;
  orderId?: string | null;
}

export interface SendResult {
  status: EmailStatus;
  providerId: string | null;
  error: string | null;
}

const RESEND_ENDPOINT = 'https://api.resend.com/emails';
const SEND_TIMEOUT_MS = 10_000;

/**
 * Envío de correo por Resend.
 *
 * Dos reglas gobiernan este servicio:
 *
 * 1. **Cerrado por defecto.** Sin `RESEND_API_KEY` + `RESEND_FROM` no se
 *    inventa un transporte ni se falla en silencio: se registra `skipped` y se
 *    devuelve. Quien necesite tratarlo como error mira `configured` primero.
 * 2. **Nunca tumba la operación que lo llama.** Un reembolso confirmado sigue
 *    confirmado aunque el correo no salga; el fallo queda en `email_log` con
 *    su mensaje para poder reenviarlo. Perder un aviso es malo, perder el
 *    registro de que devolvimos dinero sería peor.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);

  constructor(
    private readonly configService: ConfigService,
    @InjectRepository(EmailLog)
    private readonly emailLogRepository: Repository<EmailLog>,
  ) {}

  get configured(): boolean {
    return this.configService.get<ResendConfig>('resend')?.configured ?? false;
  }

  /** ¿Ya se mandó este correo para este pedido? Candado de los recordatorios. */
  async alreadySent(orderId: string, template: string): Promise<boolean> {
    const count = await this.emailLogRepository.count({
      where: { orderId, template, status: EmailStatus.SENT },
    });
    return count > 0;
  }

  /** ¿Se le mandó ya esta plantilla a esta dirección? Candado de los correos sin pedido. */
  async alreadySentTo(toAddress: string, template: string): Promise<boolean> {
    const count = await this.emailLogRepository.count({
      where: { toAddress, template, status: EmailStatus.SENT },
    });
    return count > 0;
  }

  async send(email: OutgoingEmail): Promise<SendResult> {
    const resend = this.configService.get<ResendConfig>('resend');
    if (!resend?.configured || !resend.apiKey || !resend.fromAddress) {
      this.logger.warn(
        `Correo "${email.template}" no enviado a ${email.to}: falta RESEND_API_KEY / RESEND_FROM`,
      );
      return this.record(email, {
        status: EmailStatus.SKIPPED,
        providerId: null,
        error: 'RESEND_API_KEY / RESEND_FROM sin configurar',
      });
    }

    try {
      const response = await fetch(RESEND_ENDPOINT, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${resend.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: resend.fromAddress,
          to: [email.to],
          subject: email.subject,
          html: email.html,
          text: email.text,
        }),
        signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
      });

      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const message =
          (payload as { message?: string } | null)?.message ??
          `Resend respondió ${response.status}`;
        this.logger.error(
          `Correo "${email.template}" rechazado para ${email.to}: ${message}`,
        );
        return this.record(email, {
          status: EmailStatus.FAILED,
          providerId: null,
          error: message,
        });
      }

      const providerId = (payload as { id?: string } | null)?.id ?? null;
      this.logger.log(`Correo "${email.template}" enviado a ${email.to}`);
      return this.record(email, {
        status: EmailStatus.SENT,
        providerId,
        error: null,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `Correo "${email.template}" falló para ${email.to}: ${message}`,
      );
      return this.record(email, {
        status: EmailStatus.FAILED,
        providerId: null,
        error: message,
      });
    }
  }

  private async record(
    email: OutgoingEmail,
    result: SendResult,
  ): Promise<SendResult> {
    try {
      await this.emailLogRepository.save(
        this.emailLogRepository.create({
          template: email.template,
          toAddress: email.to,
          subject: email.subject,
          orderId: email.orderId ?? null,
          status: result.status,
          providerId: result.providerId,
          errorMessage: result.error,
        }),
      );
    } catch (err) {
      this.logger.error(
        `No se pudo registrar el envío de "${email.template}"`,
        err instanceof Error ? err.stack : String(err),
      );
    }
    return result;
  }
}
