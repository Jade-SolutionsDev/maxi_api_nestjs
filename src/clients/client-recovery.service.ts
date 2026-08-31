import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClerkClient } from '@clerk/backend';
import { ClientsService } from './clients.service';
import { Client } from './entities/client.entity';

/**
 * Da de alta a un cliente que existe en Clerk y no en la base.
 *
 * El alta normal la hace el webhook `user.created`. Un webhook es una entrega
 * que puede perderse, y cuando se pierde la persona queda fuera **para
 * siempre y en silencio**: entra a la tienda —su sesión de Clerk es válida— y
 * la API le responde 401 a todo lo demás, así que no puede comprar y no hay
 * nada que se lo explique. Pasó: 28 personas quedaron así entre el 27 y el 29
 * de agosto de 2026. Ver `P-017` en el grafo.
 *
 * Esto no sustituye al webhook, lo respalda: la primera petición autenticada de
 * alguien sin fila la crea, y el evento perdido deja de importar.
 */
@Injectable()
export class ClientRecoveryService {
  private readonly logger = new Logger(ClientRecoveryService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly clientsService: ClientsService,
  ) {}

  /**
   * **Quién es cliente lo decide Clerk de la tienda, no el token.**
   *
   * `verifyToken` da por bueno un token de cualquiera de las dos instancias y
   * devuelve solo el `sub`, así que un token del backoffice llega hasta aquí
   * igual que uno de la tienda. Si diéramos de alta con lo que trae el token,
   * un administrador se convertiría en cliente de la tienda por el mero hecho
   * de tener sesión, saltándose el espejo de `CustomerProvisioningService`, que
   * los crea **desactivados** hasta que alguien los aprueba.
   *
   * Preguntándoselo a la instancia de la tienda, ese `sub` no existe allí y no
   * se crea nada. El alta automática no puede ampliar el acceso de nadie.
   */
  async recuperarDesdeClerk(clerkId: string): Promise<Client | null> {
    const secretKey = this.configService.get<string>('clerk.secretKey');
    if (!secretKey) {
      // Sin clave no se puede comprobar a quién se estaría dando de alta, y
      // dar de alta sin comprobarlo es justo lo que no puede pasar.
      this.logger.warn(
        'CLERK_SECRET_KEY no está configurada: no se recupera ningún cliente.',
      );
      return null;
    }

    const usuario = await this.buscarEnLaTienda(clerkId, secretKey);
    if (!usuario) return null;

    const correo =
      usuario.emailAddresses.find(
        (e) => e.id === usuario.primaryEmailAddressId,
      )?.emailAddress ?? usuario.emailAddresses[0]?.emailAddress;

    const cliente = await this.clientsService.createOrUpdateFromClerk(clerkId, {
      email: correo ?? undefined,
      firstName: usuario.firstName ?? undefined,
      lastName: usuario.lastName ?? undefined,
    });

    this.logger.log(
      `Cliente ${clerkId} dado de alta al autenticarse: su webhook nunca llegó.`,
    );

    return cliente;
  }

  private async buscarEnLaTienda(clerkId: string, secretKey: string) {
    try {
      return await createClerkClient({ secretKey }).users.getUser(clerkId);
    } catch (error) {
      // Lo normal aquí es un 404: el `sub` viene del backoffice, no de la
      // tienda. No es un fallo, es la comprobación haciendo su trabajo.
      this.logger.debug(
        `${clerkId} no es un usuario de la tienda; no se da de alta: ${error}`,
      );
      return null;
    }
  }
}
