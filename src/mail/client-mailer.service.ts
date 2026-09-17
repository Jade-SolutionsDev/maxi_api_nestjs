import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { StorefrontConfig, SupportConfig } from '../config/configuration';
import { Client } from '../clients/entities/client.entity';
import { EmailStatus } from './entities/email-log.entity';
import { MailService, SendResult } from './mail.service';
import { welcome } from './templates';

/** Si no hay STOREFRONT_URL configurada, los enlaces del pie apuntan aquí. */
const TIENDA_POR_DEFECTO = 'https://www.maxihabana.com';

/**
 * Los correos que van a una persona, no a un pedido. Hoy solo la bienvenida.
 *
 * Se manda cuando la cuenta queda creada de verdad —el webhook `user.created`
 * de Clerk llega después de que la persona abra su enlace de verificación—,
 * así que nadie recibe la bienvenida de una cuenta que nunca existió.
 */
@Injectable()
export class ClientMailerService {
  private readonly logger = new Logger(ClientMailerService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly mail: MailService,
  ) {}

  async welcome(client: Client): Promise<SendResult | null> {
    const to = client.email?.trim();
    if (!to) {
      this.logger.warn(
        `Bienvenida no enviada para el cliente ${client.id}: no tiene correo`,
      );
      return null;
    }

    // Una dirección recibe una sola bienvenida, aunque Clerk repita el aviso
    // o la persona borre y rehaga la cuenta con el mismo correo.
    if (await this.mail.alreadySentTo(to, 'welcome')) {
      this.logger.log(`Bienvenida ya enviada antes a ${to}; no se repite`);
      return null;
    }

    const name =
      [client.firstName, client.lastName].filter(Boolean).join(' ').trim() ||
      null;
    const rendered = welcome({
      customerName: name,
      storeUrl:
        this.configService.get<StorefrontConfig>('storefront')?.url ??
        TIENDA_POR_DEFECTO,
      whatsapp:
        this.configService.get<SupportConfig>('support')?.whatsapp ?? '',
    });

    const result = await this.mail.send({
      to,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      template: 'welcome',
    });
    if (result.status === EmailStatus.SENT) {
      this.logger.log(`Bienvenida enviada a ${to}`);
    }
    return result;
  }
}
