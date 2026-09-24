import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { UserRole } from '../permissions/entities/user-role.entity';
import { User } from '../users/entities/user.entity';

export interface Destinatarios {
  /** Direcciones únicas a las que se va a mandar. */
  correos: string[];
  /** Quién es cada una, para poder decírselo a quien lo envía. */
  detalle: { email: string; nombre: string | null; motivo: string }[];
  /** Roles pedidos que no tienen a nadie con correo: hay que avisarlo. */
  rolesVacios: string[];
  /**
   * Gente del rol que queda fuera, con el motivo. Quien marca «Economista»
   * esperando seis y recibe cinco tiene que saber cuál falta y por qué; si no,
   * lo descubre cuando alguien se queja de que no le llegó.
   *
   * Los usuarios del back-office nacen de una invitación de Clerk y su fila
   * local se rellena por webhook: si alguna se quedó a medias, hay personas en
   * el rol sin correo. Quien pulsa el botón tiene que enterarse de que a dos de
   * los seis economistas no les llegó nada, en vez de suponer que sí.
   */
  sinCorreo: { nombre: string | null; rol: string; motivo: string }[];
}

/**
 * Quién recibe el reporte.
 *
 * Los roles se resuelven **en el momento del envío**, no se guardan como una
 * lista de correos: si mañana entra otra persona al rol de Economista, recibe
 * el reporte sin que nadie se acuerde de añadirla, y si alguien sale deja de
 * recibirlo. Esa es toda la gracia de mandar «al rol» en vez de «a estas seis
 * direcciones».
 */
@Injectable()
export class ReportRecipientsService {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(UserRole)
    private readonly userRoleRepository: Repository<UserRole>,
  ) {}

  async resolver(
    emails: string[] = [],
    roleIds: string[] = [],
  ): Promise<Destinatarios> {
    const detalle: Destinatarios['detalle'] = [];
    const rolesVacios: string[] = [];
    const sinCorreo: Destinatarios['sinCorreo'] = [];

    for (const email of emails) {
      const limpio = email.trim().toLowerCase();
      if (limpio) {
        detalle.push({ email: limpio, nombre: null, motivo: 'escrito a mano' });
      }
    }

    if (roleIds.length) {
      const asignaciones = await this.userRoleRepository.find({
        where: { roleId: In(roleIds) },
        relations: { role: true },
      });
      const porRol = new Map<string, { nombre: string; usuarios: string[] }>();
      for (const id of roleIds) {
        porRol.set(id, { nombre: '', usuarios: [] });
      }
      for (const asignacion of asignaciones) {
        const entrada = porRol.get(asignacion.roleId);
        if (entrada) {
          entrada.nombre = asignacion.role?.name ?? '';
          entrada.usuarios.push(asignacion.userId);
        }
      }

      const todosLosIds = asignaciones.map((a) => a.userId);
      // Se traen TODOS, activos o no, y el descarte se hace aquí: filtrarlo en
      // la consulta dejaba a los desactivados fuera en silencio, sin poder
      // decir que existían.
      const usuarios = todosLosIds.length
        ? await this.userRepository.find({
            where: { id: In(todosLosIds) },
            withDeleted: true,
          })
        : [];
      const porId = new Map(usuarios.map((u) => [u.id, u]));

      for (const [roleId, datos] of porRol) {
        const activos = datos.usuarios
          .map((id) => porId.get(id))
          .filter((u): u is User => Boolean(u));
        const nombreDe = (u: User) =>
          [u.firstName, u.lastName].filter(Boolean).join(' ') ||
          u.email ||
          null;

        for (const usuario of activos) {
          // Mandarle las cifras de la empresa a quien ya no trabaja aquí es
          // sacarlas fuera de ella: se descarta, pero se dice.
          if (usuario.deletedAt) {
            sinCorreo.push({
              nombre: nombreDe(usuario),
              rol: datos.nombre || roleId,
              motivo: 'cuenta borrada',
            });
          } else if (!usuario.isActive) {
            sinCorreo.push({
              nombre: nombreDe(usuario),
              rol: datos.nombre || roleId,
              motivo: 'cuenta desactivada',
            });
          } else if (!usuario.email) {
            sinCorreo.push({
              nombre: nombreDe(usuario),
              rol: datos.nombre || roleId,
              motivo: 'sin correo',
            });
          }
        }
        const conCorreo = activos.filter(
          (u) => u.isActive && !u.deletedAt && Boolean(u.email),
        );
        if (!conCorreo.length) {
          rolesVacios.push(datos.nombre || roleId);
          continue;
        }
        for (const usuario of conCorreo) {
          detalle.push({
            email: (usuario.email as string).trim().toLowerCase(),
            nombre:
              [usuario.firstName, usuario.lastName].filter(Boolean).join(' ') ||
              null,
            motivo: datos.nombre || 'rol',
          });
        }
      }
    }

    // Una persona puede estar escrita a mano y además pertenecer al rol: se le
    // manda una sola vez, no dos correos iguales con el mismo adjunto.
    const vistos = new Set<string>();
    const unicos = detalle.filter((d) => {
      if (vistos.has(d.email)) return false;
      vistos.add(d.email);
      return true;
    });

    return {
      correos: unicos.map((d) => d.email),
      detalle: unicos,
      rolesVacios,
      sinCorreo,
    };
  }
}
