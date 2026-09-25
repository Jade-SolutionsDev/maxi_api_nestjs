import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { createClerkClient } from '@clerk/backend';
import { Repository } from 'typeorm';
import { StorefrontConfig, SupportConfig } from '../config/configuration';
import { EmailStatus } from '../mail/entities/email-log.entity';
import { MailService } from '../mail/mail.service';
import { clientInvitation } from '../mail/templates';
import {
  ClientInvitationResponseDto,
  InviteClientDto,
} from './dto/invite-client.dto';
import { Client } from './entities/client.entity';

/**
 * Dar de alta desde el back-office a alguien que compró por otro canal.
 *
 * Un cliente no nace en nuestra base: nace en Clerk. Por eso el `POST /clients`
 * de toda la vida no sirve para esto —exige un `clerkId` que el back-office no
 * tiene de dónde sacar— y el botón de crear del panel estaba comentado: crear
 * la fila local a secas daría clientes que existen en la base y no pueden
 * entrar en la tienda.
 *
 * Aquí se invita, como a los trabajadores: se crea la invitación en el Clerk de
 * la TIENDA y el cliente elige su propia contraseña. La fila de `clients`
 * aparece sola cuando la acepta, por el webhook de siempre.
 */
@Injectable()
export class ClientInvitationsService {
  private readonly logger = new Logger(ClientInvitationsService.name);

  constructor(
    private readonly configService: ConfigService,
    @InjectRepository(Client)
    private readonly clientsRepository: Repository<Client>,
    private readonly mail: MailService,
  ) {}

  private storefrontClerk() {
    const secretKey = this.configService.get<string>('clerk.secretKey');
    if (!secretKey) {
      throw new Error('CLERK_SECRET_KEY is not configured');
    }
    return createClerkClient({ secretKey });
  }

  async invite(dto: InviteClientDto): Promise<ClientInvitationResponseDto> {
    const email = dto.email.trim().toLowerCase();

    const yaEsCliente = await this.clientsRepository.findOne({
      where: { email },
    });
    if (yaEsCliente) {
      throw new ConflictException(
        `${email} ya es cliente de la tienda. Búscalo en el listado.`,
      );
    }

    const clerk = this.storefrontClerk();

    const enClerk = await clerk.users.getUserList({ emailAddress: [email] });
    if (enClerk.totalCount > 0) {
      throw new ConflictException(
        `${email} ya tiene cuenta en la tienda, aunque no aparezca en el listado. Que entre con «¿Olvidaste tu contraseña?».`,
      );
    }

    // Una invitación vieja para el mismo correo bloquea la nueva, así que se
    // retira: quien invita otra vez es porque la primera no llegó.
    await this.revocarPendientes(clerk, email);

    const tienda = this.configService.get<StorefrontConfig>('storefront')?.url;
    const invitacion = await clerk.invitations.createInvitation({
      emailAddress: email,
      // El correo lo mandamos nosotros. Clerk sabe hacerlo, pero ya se le ha
      // visto aceptar la invitación y no entregar nada; con Resend queda
      // registrado en `email_log` y se puede comprobar si salió.
      notify: false,
      redirectUrl: tienda ? `${tienda}/invitacion` : undefined,
      publicMetadata: {
        invitadoDesde: 'back-office',
        firstName: dto.firstName ?? null,
        lastName: dto.lastName ?? null,
      },
    });

    const nombre =
      [dto.firstName, dto.lastName].filter(Boolean).join(' ').trim() || null;
    const correo = clientInvitation({
      customerName: nombre,
      invitationUrl: invitacion.url ?? '',
      storeUrl: tienda ?? null,
      whatsapp:
        this.configService.get<SupportConfig>('support')?.whatsapp ?? '',
    });

    const enviado = await this.mail.send({
      to: email,
      subject: correo.subject,
      html: correo.html,
      text: correo.text,
      template: 'client_invitation',
    });

    if (enviado.status !== EmailStatus.SENT) {
      // No se anula la invitación: sigue siendo válida y el panel enseña el
      // enlace para dárselo a mano. Quedarse sin correo no puede dejar al
      // cliente sin cuenta.
      this.logger.warn(
        `Invitación de ${email} creada, pero el correo no salió: ${enviado.error ?? 'sin motivo'}`,
      );
    }

    return {
      email,
      invitationId: invitacion.id,
      url: invitacion.url ?? '',
      emailSent: enviado.status === EmailStatus.SENT,
    };
  }

  private async revocarPendientes(
    clerk: ReturnType<typeof createClerkClient>,
    email: string,
  ): Promise<void> {
    try {
      const { data } = await clerk.invitations.getInvitationList({
        status: 'pending',
      });
      for (const pendiente of data) {
        if (pendiente.emailAddress.toLowerCase() === email) {
          await clerk.invitations.revokeInvitation(pendiente.id);
        }
      }
    } catch (err) {
      // Que no se pueda limpiar lo viejo no impide invitar de nuevo.
      this.logger.warn(
        `No se pudieron revisar las invitaciones pendientes de ${email}: ${String(err)}`,
      );
    }
  }
}
