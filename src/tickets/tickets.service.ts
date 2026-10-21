import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import {
  PaginatedResponse,
  buildPaginatedResponse,
} from '../common/dto/pagination.dto';
import {
  comoBusquedaParcial,
  sinTildes,
} from '../common/search/accent-insensitive';
import { NomenclatorsService } from '../nomenclators/nomenclators.service';
import { User } from '../users/entities/user.entity';
import {
  ChangeTicketStatusDto,
  CreateTicketDto,
  TicketEventResponseDto,
  TicketNames,
  TicketResponseDto,
  TicketsQueryDto,
  UpdateTicketDto,
} from './dto/ticket.dto';
import { TicketEvent, TicketEventKind } from './entities/ticket-event.entity';
import { Ticket, TicketPriority, TicketStatus } from './entities/ticket.entity';
import { TicketMailerService } from './ticket-mailer.service';

export const TICKET_CATEGORY = 'ticket-category';

/**
 * Por dónde puede moverse un ticket (MxH-0065).
 *
 * `resuelto` lo pone quien lo arregló y `cerrado` quien lo abrió o quien
 * supervisa: son dos afirmaciones distintas y las hace gente distinta.
 *
 * **Se puede volver atrás desde los dos finales.** Desde `resuelto`, porque lo
 * normal es que quien tiene que confirmarlo descubra que no estaba arreglado, y
 * entonces continúa el ticket de siempre en vez de abrir otro que empieza sin
 * historial. Y desde `cerrado`, porque cerrar por error no puede ser
 * irreversible —reabrir pide el mismo permiso que cerró—.
 */
const TRANSICIONES: Record<TicketStatus, TicketStatus[]> = {
  [TicketStatus.ABIERTO]: [TicketStatus.EN_CURSO, TicketStatus.RESUELTO],
  [TicketStatus.EN_CURSO]: [TicketStatus.ABIERTO, TicketStatus.RESUELTO],
  [TicketStatus.RESUELTO]: [TicketStatus.EN_CURSO, TicketStatus.CERRADO],
  [TicketStatus.CERRADO]: [TicketStatus.EN_CURSO],
};

/** Los pasos que exigen `tickets:close`. */
const EXIGEN_PERMISO_DE_CIERRE: readonly TicketStatus[] = [
  TicketStatus.CERRADO,
];

/**
 * Las incidencias internas de la tienda.
 *
 * Abrir y comentar es de cualquiera que tenga `tickets:create`; **cerrar pide
 * `tickets:close`**, que se concede aparte. Marcar `resuelto` no lo pide: es
 * quien arregló diciendo que arregló, y justamente el sentido de los cuatro
 * estados es que esa palabra no sea la última.
 */
@Injectable()
export class TicketsService {
  constructor(
    @InjectRepository(Ticket)
    private readonly ticketRepository: Repository<Ticket>,
    @InjectRepository(TicketEvent)
    private readonly eventRepository: Repository<TicketEvent>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly nomenclatorsService: NomenclatorsService,
    private readonly mailer: TicketMailerService,
  ) {}

  async create(
    dto: CreateTicketDto,
    userId: string,
  ): Promise<TicketResponseDto> {
    await this.exigirCategoria(dto.categoryId);
    if (dto.assignedUserId) await this.exigirUsuario(dto.assignedUserId);

    const ticket = await this.ticketRepository.save(
      this.ticketRepository.create({
        title: dto.title.trim(),
        description: dto.description,
        categoryId: dto.categoryId,
        // Explícito y no por omisión de la columna: así la entidad que viaja
        // al correo y al historial ya lleva la prioridad, sin depender de
        // releer la fila para saberla.
        priority: dto.priority ?? TicketPriority.MEDIA,
        status: TicketStatus.ABIERTO,
        assignedUserId: dto.assignedUserId ?? null,
        createdByUserId: userId,
        images: dto.images ?? [],
      }),
    );

    await this.anotar(ticket.id, userId, TicketEventKind.ABIERTO, {
      toStatus: TicketStatus.ABIERTO,
    });
    if (ticket.assignedUserId) {
      await this.anotar(ticket.id, userId, TicketEventKind.ASIGNADO, {});
      await this.mailer.avisarAsignado(ticket);
    }

    return this.findOne(ticket.id);
  }

  async findAll(
    query: TicketsQueryDto,
  ): Promise<PaginatedResponse<TicketResponseDto>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const columnas: Record<string, string> = {
      createdAt: 't.createdAt',
      updatedAt: 't.updatedAt',
      status: 't.status',
      priority: 't.priority',
      title: 't.title',
    };
    const columna = columnas[query.sortBy ?? ''] ?? 't.createdAt';
    const dir = (query.sortOrder ?? 'desc').toUpperCase() as 'ASC' | 'DESC';

    const qb = this.ticketRepository
      .createQueryBuilder('t')
      .orderBy(columna, dir)
      .skip((page - 1) * limit)
      .take(limit);

    if (query.q) {
      // Título y descripción, y sin tildes como el resto de las búsquedas:
      // «impresion» tiene que encontrar «impresión».
      qb.andWhere(
        `((${sinTildes('t.title')}) OR (${sinTildes('t.description')}))`,
        { q: comoBusquedaParcial(query.q) },
      );
    }
    if (query.status) {
      qb.andWhere('t.status = :status', { status: query.status });
    }
    if (query.priority) {
      qb.andWhere('t.priority = :priority', { priority: query.priority });
    }
    if (query.categoryId) {
      qb.andWhere('t.categoryId = :categoryId', {
        categoryId: query.categoryId,
      });
    }
    if (query.assignedUserId) {
      qb.andWhere('t.assignedUserId = :assignedUserId', {
        assignedUserId: query.assignedUserId,
      });
    }
    if (query.createdByUserId) {
      qb.andWhere('t.createdByUserId = :createdByUserId', {
        createdByUserId: query.createdByUserId,
      });
    }
    if (query.createdFrom) {
      qb.andWhere('t.createdAt >= :createdFrom', {
        createdFrom: query.createdFrom,
      });
    }
    if (query.createdTo) {
      // Día inclusivo: todo lo anterior al día siguiente.
      qb.andWhere("t.createdAt < :createdTo::date + interval '1 day'", {
        createdTo: query.createdTo,
      });
    }

    const [filas, total] = await qb.getManyAndCount();
    const nombres = await this.nombresDe(filas);

    return buildPaginatedResponse(
      filas.map((fila) =>
        TicketResponseDto.fromEntity(fila, nombres.get(fila.id)!),
      ),
      total,
      page,
      limit,
    );
  }

  async findOne(id: string): Promise<TicketResponseDto> {
    const ticket = await this.exigirTicket(id);
    const nombres = await this.nombresDe([ticket]);
    const dto = TicketResponseDto.fromEntity(ticket, nombres.get(ticket.id)!);

    const eventos = await this.eventRepository.find({
      where: { ticketId: id },
      order: { createdAt: 'ASC' },
    });
    const autores = await this.nombresDeUsuarios(
      eventos.map((evento) => evento.userId),
    );
    dto.events = eventos.map((evento) =>
      TicketEventResponseDto.fromEntity(
        evento,
        autores.get(evento.userId) ?? null,
      ),
    );

    return dto;
  }

  async update(
    id: string,
    dto: UpdateTicketDto,
    userId: string,
  ): Promise<TicketResponseDto> {
    const ticket = await this.exigirTicket(id);

    if (dto.categoryId && dto.categoryId !== ticket.categoryId) {
      await this.exigirCategoria(dto.categoryId);
      ticket.categoryId = dto.categoryId;
    }
    if (dto.title !== undefined) ticket.title = dto.title.trim();
    if (dto.description !== undefined) ticket.description = dto.description;
    if (dto.priority !== undefined) ticket.priority = dto.priority;
    if (dto.images !== undefined) ticket.images = dto.images;

    let asignacionNueva: string | null | undefined;
    if (dto.assignedUserId !== undefined) {
      const asignado = dto.assignedUserId.trim() || null;
      if (asignado) await this.exigirUsuario(asignado);
      if (asignado !== ticket.assignedUserId) {
        ticket.assignedUserId = asignado;
        asignacionNueva = asignado;
      }
    }

    await this.ticketRepository.save(ticket);
    await this.anotar(id, userId, TicketEventKind.EDITADO, {});
    if (asignacionNueva !== undefined) {
      await this.anotar(id, userId, TicketEventKind.ASIGNADO, {
        note: asignacionNueva ? null : 'Queda sin asignar',
      });
      // Solo cuando hay a quién avisar: quitar la asignación no manda nada.
      if (asignacionNueva) await this.mailer.avisarAsignado(ticket);
    }

    return this.findOne(id);
  }

  /**
   * Mueve el ticket de estado.
   *
   * `puedeCerrar` lo trae el controlador desde el permiso. Cerrar es dar la
   * incidencia por buena, y reabrir algo cerrado es deshacer eso: las dos
   * cosas piden el mismo permiso.
   */
  async changeStatus(
    id: string,
    dto: ChangeTicketStatusDto,
    userId: string,
    puedeCerrar: boolean,
  ): Promise<TicketResponseDto> {
    const ticket = await this.exigirTicket(id);

    if (dto.status === ticket.status) {
      throw new BadRequestException(`El ticket ya está "${ticket.status}"`);
    }
    if (!TRANSICIONES[ticket.status].includes(dto.status)) {
      throw new BadRequestException(
        `Un ticket "${ticket.status}" no puede pasar a "${dto.status}"`,
      );
    }

    const reabreUnCerrado = ticket.status === TicketStatus.CERRADO;
    if (
      (EXIGEN_PERMISO_DE_CIERRE.includes(dto.status) || reabreUnCerrado) &&
      !puedeCerrar
    ) {
      throw new ForbiddenException(
        reabreUnCerrado
          ? 'Hace falta el permiso para cerrar tickets también para reabrir uno cerrado'
          : 'Hace falta el permiso para cerrar tickets',
      );
    }
    if (dto.status === TicketStatus.RESUELTO && !dto.note?.trim()) {
      throw new BadRequestException(
        'Di qué hiciste: hace falta para quien tiene que confirmarlo y para el próximo que se tropiece con lo mismo',
      );
    }
    if (reabreUnCerrado && !dto.note?.trim()) {
      throw new BadRequestException(
        'Di por qué lo reabres: el ticket ya estaba dado por bueno',
      );
    }

    const anterior = ticket.status;
    ticket.status = dto.status;

    if (dto.status === TicketStatus.RESUELTO) {
      ticket.resolution = dto.note!.trim();
      ticket.resolvedAt = new Date();
      ticket.closedAt = null;
    } else if (dto.status === TicketStatus.CERRADO) {
      // Cerrar confirma la resolución: no se toca lo que escribió quien
      // arregló, se le pone fecha al visto bueno.
      ticket.closedAt = new Date();
    } else {
      // Volver atrás borra el cierre: dejarlo puesto haría leer como resuelto
      // un ticket que volvió a estar vivo.
      ticket.resolution = null;
      ticket.resolvedAt = null;
      ticket.closedAt = null;
    }
    await this.ticketRepository.save(ticket);

    await this.anotar(id, userId, TicketEventKind.ESTADO, {
      fromStatus: anterior,
      toStatus: dto.status,
      note: dto.note?.trim() || null,
    });

    return this.findOne(id);
  }

  async addComment(
    id: string,
    note: string,
    userId: string,
  ): Promise<TicketResponseDto> {
    await this.exigirTicket(id);
    await this.anotar(id, userId, TicketEventKind.COMENTARIO, { note });
    return this.findOne(id);
  }

  // ---------------- Dentro de casa ----------------

  private async anotar(
    ticketId: string,
    userId: string,
    kind: TicketEventKind,
    datos: {
      fromStatus?: TicketStatus;
      toStatus?: TicketStatus;
      note?: string | null;
    },
  ): Promise<void> {
    await this.eventRepository.save(
      this.eventRepository.create({
        ticketId,
        userId,
        kind,
        fromStatus: datos.fromStatus ?? null,
        toStatus: datos.toStatus ?? null,
        note: datos.note ?? null,
      }),
    );
  }

  private async exigirTicket(id: string): Promise<Ticket> {
    const ticket = await this.ticketRepository.findOne({ where: { id } });
    if (!ticket) throw new NotFoundException(`No existe el ticket "${id}"`);
    return ticket;
  }

  private async exigirCategoria(categoryId: string): Promise<void> {
    const categoria = await this.nomenclatorsService.findActiveOption(
      TICKET_CATEGORY,
      categoryId,
    );
    if (!categoria) {
      throw new BadRequestException(
        'Esa categoría de ticket no existe o está inactiva',
      );
    }
  }

  private async exigirUsuario(userId: string): Promise<void> {
    const existe = await this.userRepository.exists({ where: { id: userId } });
    if (!existe) throw new BadRequestException('Ese usuario no existe');
  }

  private async nombresDeUsuarios(
    ids: string[],
  ): Promise<Map<string, string | null>> {
    const unicos = [...new Set(ids.filter(Boolean))];
    if (!unicos.length) return new Map();
    const usuarios = await this.userRepository.find({
      where: { id: In(unicos) },
    });
    return new Map(
      usuarios.map((usuario) => [
        usuario.id,
        [usuario.firstName, usuario.lastName].filter(Boolean).join(' ') ||
          usuario.email ||
          null,
      ]),
    );
  }

  /** Las etiquetas de varios tickets en dos consultas, nunca una por fila. */
  private async nombresDe(
    tickets: Ticket[],
  ): Promise<Map<string, TicketNames>> {
    if (!tickets.length) return new Map();

    const etiquetas = await this.nomenclatorsService.labelsFor(
      tickets.map((ticket) => ticket.categoryId),
    );

    const usuarios = await this.nombresDeUsuarios([
      ...tickets
        .map((ticket) => ticket.assignedUserId)
        .filter((id): id is string => Boolean(id)),
      ...tickets.map((ticket) => ticket.createdByUserId),
    ]);

    return new Map(
      tickets.map((ticket) => [
        ticket.id,
        {
          categoryLabel: etiquetas.get(ticket.categoryId) ?? null,
          assignedUserName: ticket.assignedUserId
            ? (usuarios.get(ticket.assignedUserId) ?? null)
            : null,
          createdByUserName: usuarios.get(ticket.createdByUserId) ?? null,
        },
      ]),
    );
  }
}
