import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { MoreThanOrEqual, Repository } from 'typeorm';
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
  /**
   * Ficheros que viajan con el correo. Hoy solo el comprobante del pedido:
   * el cliente recibe su factura sin tener que entrar en la web ni buscar
   * el enlace. El contenido va en memoria y se codifica aquí.
   */
  attachments?: OutgoingAttachment[];
}

export interface OutgoingAttachment {
  /** Lo que verá el cliente al guardarlo, con extensión. */
  filename: string;
  content: Buffer;
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
 * 2. **Apagable por plantilla.** `MAIL_TEMPLATES_OFF` corta plantillas
 *    concretas sin tocar el código que las dispara: el envío se registra
 *    `skipped` con el motivo y quien llamaba no se entera. Es lo que permite
 *    tener un correo escrito y probado en staging y aún no encendido en
 *    producción.
 * 3. **Reserva de cupo.** El plan tiene un tope mensual y otro diario. Las
 *    plantillas prescindibles dejan de salir antes de rozarlo, para que el
 *    margen que queda sea de los correos del dinero y la entrega: un tope
 *    agotado no elige a quién corta, y el siguiente podría ser el de quien
 *    acaba de pagar.
 * 4. **Nunca tumba la operación que lo llama.** Un reembolso confirmado sigue
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

  /** ¿Está apagada esta plantilla en este entorno? */
  apagada(template: string): boolean {
    const resend = this.configService.get<ResendConfig>('resend');
    return resend?.plantillasApagadas?.includes(template) ?? false;
  }

  /**
   * ¿Queda cupo para esta plantilla?
   *
   * Las intocables gastan hasta el límite real; las prescindibles se paran en
   * el límite menos la reserva. Si la consulta falla se deja pasar el correo:
   * quedarse sin contador no es motivo para dejar de avisar a un cliente.
   */
  async hayCupo(template: string): Promise<{ ok: boolean; motivo?: string }> {
    const resend = this.configService.get<ResendConfig>('resend');
    if (!resend) return { ok: true };

    // Accesos defensivos a propósito: una configuración incompleta —un
    // despliegue viejo, una prueba que solo monta lo suyo— no puede dejar
    // sin correo a nadie. Sin cupos declarados, no hay nada que racionar.
    const prescindible =
      resend.plantillasPrescindibles?.includes(template) ?? false;
    if (!prescindible) return { ok: true };

    const cupoMensual = resend.cupoMensual ?? 0;
    const cupoDiario = resend.cupoDiario ?? 0;
    if (cupoMensual <= 0 && cupoDiario <= 0) return { ok: true };

    const mensual = cupoMensual - (resend.reservaMensual ?? 0);
    const diario = cupoDiario - (resend.reservaDiaria ?? 0);

    try {
      const ahora = new Date();
      const inicioDeMes = new Date(
        Date.UTC(ahora.getUTCFullYear(), ahora.getUTCMonth(), 1),
      );
      const inicioDeHoy = new Date(
        Date.UTC(
          ahora.getUTCFullYear(),
          ahora.getUTCMonth(),
          ahora.getUTCDate(),
        ),
      );

      const [delMes, deHoy] = await Promise.all([
        this.contarEnviadosDesde(inicioDeMes),
        this.contarEnviadosDesde(inicioDeHoy),
      ]);

      if (cupoMensual > 0 && delMes >= mensual) {
        return {
          ok: false,
          motivo: `reserva de cupo: ${delMes} enviados este mes, el margen para lo esencial empieza en ${mensual}`,
        };
      }
      if (cupoDiario > 0 && deHoy >= diario) {
        return {
          ok: false,
          motivo: `reserva de cupo: ${deHoy} enviados hoy, el margen para lo esencial empieza en ${diario}`,
        };
      }
      return { ok: true };
    } catch (err) {
      this.logger.error(
        'No se pudo comprobar el cupo de correo; se deja pasar el envío',
        err instanceof Error ? err.stack : String(err),
      );
      return { ok: true };
    }
  }

  private contarEnviadosDesde(desde: Date): Promise<number> {
    return this.emailLogRepository.count({
      where: { status: EmailStatus.SENT, createdAt: MoreThanOrEqual(desde) },
    });
  }

  async send(email: OutgoingEmail): Promise<SendResult> {
    const resend = this.configService.get<ResendConfig>('resend');

    // Antes que lo demás: una plantilla apagada no se manda ni aunque haya
    // credenciales. Se registra igual, para que el día que se encienda se
    // pueda ver cuántos se habrían mandado.
    if (this.apagada(email.template)) {
      this.logger.log(
        `Correo "${email.template}" no enviado a ${email.to}: plantilla apagada en este entorno`,
      );
      return this.record(email, {
        status: EmailStatus.SKIPPED,
        providerId: null,
        error: 'plantilla apagada por MAIL_TEMPLATES_OFF',
      });
    }

    const cupo = await this.hayCupo(email.template);
    if (!cupo.ok) {
      this.logger.warn(
        `Correo "${email.template}" no enviado a ${email.to}: ${cupo.motivo}`,
      );
      return this.record(email, {
        status: EmailStatus.SKIPPED,
        providerId: null,
        error: cupo.motivo ?? 'reserva de cupo',
      });
    }

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
          // Sin esto la respuesta del cliente vuelve al remitente, que es una
          // dirección de un dominio que no recibe correo: se pierde entera.
          ...(resend.replyTo ? { reply_to: resend.replyTo } : {}),
          subject: email.subject,
          html: email.html,
          text: email.text,
          // Resend los quiere en base64. Sin adjuntos no se manda el campo:
          // un array vacío hace que algunos clientes pinten el clip igual.
          ...(email.attachments?.length
            ? {
                attachments: email.attachments.map((file) => ({
                  filename: file.filename,
                  content: file.content.toString('base64'),
                })),
              }
            : {}),
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
