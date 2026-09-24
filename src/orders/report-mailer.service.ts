import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EmailStatus } from '../mail/entities/email-log.entity';
import { MailService } from '../mail/mail.service';
import { reportReady } from '../mail/templates';
import { StorefrontConfig, SupportConfig } from '../config/configuration';

export interface EnvioDelReporte {
  enviados: string[];
  fallidos: { email: string; motivo: string }[];
}

/**
 * Manda el reporte por correo, con el PDF adjunto.
 *
 * Va uno a uno y no en copia oculta: si una dirección rebota, las demás no se
 * enteran ni se quedan sin él, y en `email_log` queda una fila por persona —que
 * es lo que permite responder a «¿le llegó a Fulano?» sin adivinar.
 */
@Injectable()
export class ReportMailerService {
  private readonly logger = new Logger(ReportMailerService.name);

  constructor(
    private readonly mail: MailService,
    private readonly configService: ConfigService,
  ) {}

  get configured(): boolean {
    return this.mail.configured;
  }

  async enviar(
    destinatarios: string[],
    pdf: Buffer,
    nombreDelFichero: string,
    datos: {
      criterios: string;
      pedidos: number;
      importe: string;
      solicitante: string | null;
    },
  ): Promise<EnvioDelReporte> {
    const rendered = reportReady({
      ...datos,
      whatsapp:
        this.configService.get<SupportConfig>('support')?.whatsapp ?? '',
      storeUrl:
        this.configService.get<StorefrontConfig>('storefront')?.url ?? null,
    });

    const enviados: string[] = [];
    const fallidos: { email: string; motivo: string }[] = [];

    for (const email of destinatarios) {
      try {
        const resultado = await this.mail.send({
          to: email,
          subject: rendered.subject,
          html: rendered.html,
          text: rendered.text,
          template: 'orders_report',
          attachments: [{ filename: nombreDelFichero, content: pdf }],
        });
        if (resultado.status === EmailStatus.SENT) {
          enviados.push(email);
        } else {
          fallidos.push({
            email,
            motivo: resultado.error ?? `estado ${resultado.status}`,
          });
        }
      } catch (err) {
        // Que falle uno no puede dejar sin reporte a los demás.
        this.logger.error(
          `El reporte no salió para ${email}`,
          err instanceof Error ? err.stack : String(err),
        );
        fallidos.push({
          email,
          motivo: err instanceof Error ? err.message : 'error desconocido',
        });
      }
    }

    return { enviados, fallidos };
  }
}
