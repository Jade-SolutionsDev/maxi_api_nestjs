import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClerkClient } from '@clerk/backend';
import { ClientsService } from './clients.service';

/** Lo que una pasada deja contado. */
export interface InformeDeReconciliacion {
  /** Usuarios vistos en la instancia de Clerk de la tienda. */
  enClerk: number;
  /** De esos, cuántos ya tenían su fila en `clients`. */
  conFila: number;
  /** Cuántos no la tenían. */
  sinFila: number;
  /** Cuántas filas se crearon. Siempre 0 cuando solo se informa. */
  creados: number;
  /** Quiénes faltaban, para poder mirarlos uno a uno. */
  faltantes: { clerkId: string; email: string | null; creado: boolean }[];
  /** Quién no se pudo dar de alta y por qué. */
  conflictos: { clerkId: string; email: string | null; motivo: string }[];
  /** `true` cuando no se escribió nada. */
  soloInforme: boolean;
}

/** Lo que Clerk entrega por página; 100 es su máximo. */
const POR_PAGINA = 100;

/**
 * Compara la instancia de Clerk de la tienda contra `clients` y da de alta a
 * quien falte.
 *
 * `ClientRecoveryService` ya repara a una persona **cuando entra**, y con eso
 * nadie vuelve a quedarse fuera para siempre. Pero reparar al entrar solo
 * alcanza a quien vuelve: quien probó una vez, no pudo comprar y no regresó
 * sigue sin fila, y nadie sabe cuántos son. Eso es lo que esta pasada
 * contesta, y por eso informa aunque no escriba nada.
 *
 * El sentido es siempre Clerk → base, nunca al revés: aquí no se borra ni se
 * desactiva a nadie.
 */
@Injectable()
export class ClientReconciliationService {
  private readonly logger = new Logger(ClientReconciliationService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly clientsService: ClientsService,
  ) {}

  /**
   * @param soloInforme cuenta sin escribir. Es el valor por omisión a
   * propósito: sobre una base de producción conviene mirar antes de tocar.
   */
  async reconciliar(soloInforme = true): Promise<InformeDeReconciliacion> {
    const secretKey = this.configService.get<string>('clerk.secretKey');
    if (!secretKey) {
      // Sin clave no se puede preguntar quién es cliente, y dar de alta sin
      // preguntarlo es justo lo que no puede pasar.
      throw new Error(
        'CLERK_SECRET_KEY no está configurada: no se puede reconciliar.',
      );
    }

    const clerk = createClerkClient({ secretKey });
    const informe: InformeDeReconciliacion = {
      enClerk: 0,
      conFila: 0,
      sinFila: 0,
      creados: 0,
      faltantes: [],
      conflictos: [],
      soloInforme,
    };

    for (let offset = 0; ; offset += POR_PAGINA) {
      const pagina = await clerk.users.getUserList({
        limit: POR_PAGINA,
        offset,
      });
      const usuarios = pagina.data;
      if (usuarios.length === 0) break;

      for (const usuario of usuarios) {
        informe.enClerk += 1;
        await this.revisar(usuario, informe, soloInforme);
      }

      if (usuarios.length < POR_PAGINA) break;
    }

    const resumen = `Reconciliación Clerk → clients: ${informe.enClerk} en Clerk, ${informe.sinFila} sin fila, ${informe.creados} dados de alta, ${informe.conflictos.length} con conflicto.`;
    if (informe.sinFila > 0) {
      // Que falte alguien significa que se perdió un webhook, y eso hoy no
      // deja rastro en ningún sitio. El aviso es el rastro.
      this.logger.warn(resumen);
    } else {
      this.logger.log(resumen);
    }

    return informe;
  }

  private async revisar(
    usuario: {
      id: string;
      firstName: string | null;
      lastName: string | null;
      primaryEmailAddressId: string | null;
      emailAddresses: { id: string; emailAddress: string }[];
    },
    informe: InformeDeReconciliacion,
    soloInforme: boolean,
  ): Promise<void> {
    const existente = await this.clientsService.findByClerkId(usuario.id, {
      withDeleted: true,
    });
    if (existente) {
      informe.conFila += 1;
      return;
    }

    informe.sinFila += 1;
    const email = this.correoDe(usuario);

    if (soloInforme) {
      informe.faltantes.push({ clerkId: usuario.id, email, creado: false });
      return;
    }

    try {
      await this.clientsService.createOrUpdateFromClerk(usuario.id, {
        email: email ?? undefined,
        firstName: usuario.firstName ?? undefined,
        lastName: usuario.lastName ?? undefined,
      });
      informe.creados += 1;
      informe.faltantes.push({ clerkId: usuario.id, email, creado: true });
    } catch (error) {
      // El caso conocido es el correo repetido: alguien que no pudo comprar y
      // se registró de nuevo con otra dirección tiene dos usuarios en Clerk y
      // una sola fila. Fundir las dos cuentas es una decisión de negocio, no
      // algo que esta pasada pueda tomar sola, así que se anota y se sigue.
      const motivo = error instanceof Error ? error.message : String(error);
      informe.conflictos.push({ clerkId: usuario.id, email, motivo });
      informe.faltantes.push({ clerkId: usuario.id, email, creado: false });
      this.logger.warn(
        `No se pudo dar de alta a ${usuario.id} (${email ?? 'sin correo'}): ${motivo}`,
      );
    }
  }

  private correoDe(usuario: {
    primaryEmailAddressId: string | null;
    emailAddresses: { id: string; emailAddress: string }[];
  }): string | null {
    return (
      usuario.emailAddresses.find(
        (correo) => correo.id === usuario.primaryEmailAddressId,
      )?.emailAddress ??
      usuario.emailAddresses[0]?.emailAddress ??
      null
    );
  }
}
