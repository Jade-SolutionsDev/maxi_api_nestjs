import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Client } from '../clients/entities/client.entity';
import {
  PaginatedResponse,
  buildPaginatedResponse,
} from '../common/dto/pagination.dto';
import {
  comoBusquedaParcial,
  sinTildes,
} from '../common/search/accent-insensitive';
import { NomenclatorsService } from '../nomenclators/nomenclators.service';
import { Order } from '../orders/entities/order.entity';
import { User } from '../users/entities/user.entity';
import {
  ChangeComplaintStatusDto,
  ComplaintEventResponseDto,
  ComplaintNames,
  ComplaintResponseDto,
  ComplaintsQueryDto,
  CreateComplaintDto,
  UpdateComplaintDto,
} from './dto/complaint.dto';
import {
  ComplaintEvent,
  ComplaintEventKind,
} from './entities/complaint-event.entity';
import { Complaint, ComplaintStatus } from './entities/complaint.entity';

export const COMPLAINT_MOTIVE_CATEGORY = 'complaint-motive';

/**
 * Por dónde puede moverse una queja.
 *
 * Se puede reabrir una resuelta: un cliente que vuelve a llamar por lo mismo
 * no abre un caso nuevo, continúa el suyo, y el historial tiene que quedar en
 * un solo sitio.
 */
const TRANSICIONES: Record<ComplaintStatus, ComplaintStatus[]> = {
  [ComplaintStatus.ABIERTA]: [
    ComplaintStatus.EN_GESTION,
    ComplaintStatus.RESUELTA,
  ],
  [ComplaintStatus.EN_GESTION]: [
    ComplaintStatus.ABIERTA,
    ComplaintStatus.RESUELTA,
  ],
  [ComplaintStatus.RESUELTA]: [ComplaintStatus.EN_GESTION],
};

/**
 * Las quejas que recibe el Call Center.
 *
 * Registrar y consultar es cosa del propio Call Center; **cerrar una queja
 * pide el permiso `complaints:close`**, que se concede aparte (MxH-0064).
 * Quien registra no decide si lo suyo quedó resuelto.
 */
@Injectable()
export class ComplaintsService {
  constructor(
    @InjectRepository(Complaint)
    private readonly complaintRepository: Repository<Complaint>,
    @InjectRepository(ComplaintEvent)
    private readonly eventRepository: Repository<ComplaintEvent>,
    @InjectRepository(Client)
    private readonly clientRepository: Repository<Client>,
    @InjectRepository(Order)
    private readonly orderRepository: Repository<Order>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly nomenclatorsService: NomenclatorsService,
  ) {}

  async create(
    dto: CreateComplaintDto,
    userId: string,
  ): Promise<ComplaintResponseDto> {
    await this.exigirMotivo(dto.motiveId);
    await this.exigirCliente(dto.clientId);
    if (dto.orderId)
      await this.exigirPedidoDelCliente(dto.orderId, dto.clientId);

    const queja = await this.complaintRepository.save(
      this.complaintRepository.create({
        clientId: dto.clientId,
        orderId: dto.orderId ?? null,
        motiveId: dto.motiveId,
        description: dto.description,
        status: ComplaintStatus.ABIERTA,
        createdByUserId: userId,
      }),
    );

    await this.anotar(queja.id, userId, ComplaintEventKind.REGISTRADA, {
      toStatus: ComplaintStatus.ABIERTA,
    });

    return this.findOne(queja.id);
  }

  async findAll(
    query: ComplaintsQueryDto,
  ): Promise<PaginatedResponse<ComplaintResponseDto>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const columnas: Record<string, string> = {
      createdAt: 'c.createdAt',
      status: 'c.status',
      updatedAt: 'c.updatedAt',
    };
    const columna = columnas[query.sortBy ?? ''] ?? 'c.createdAt';
    const dir = (query.sortOrder ?? 'desc').toUpperCase() as 'ASC' | 'DESC';

    const qb = this.complaintRepository
      .createQueryBuilder('c')
      .orderBy(columna, dir)
      .skip((page - 1) * limit)
      .take(limit);

    if (query.q) {
      // Sin tildes, como el resto de las búsquedas: «devolucion» tiene que
      // encontrar «devolución».
      qb.andWhere(`(${sinTildes('c.description')})`, {
        q: comoBusquedaParcial(query.q),
      });
    }
    if (query.status)
      qb.andWhere('c.status = :status', { status: query.status });
    if (query.motiveId) {
      qb.andWhere('c.motiveId = :motiveId', { motiveId: query.motiveId });
    }
    if (query.clientId) {
      qb.andWhere('c.clientId = :clientId', { clientId: query.clientId });
    }
    if (query.orderId) {
      qb.andWhere('c.orderId = :orderId', { orderId: query.orderId });
    }
    if (query.assignedUserId) {
      qb.andWhere('c.assignedUserId = :assignedUserId', {
        assignedUserId: query.assignedUserId,
      });
    }
    if (query.createdFrom) {
      qb.andWhere('c.createdAt >= :createdFrom', {
        createdFrom: query.createdFrom,
      });
    }
    if (query.createdTo) {
      // Día inclusivo: todo lo anterior al día siguiente.
      qb.andWhere("c.createdAt < :createdTo::date + interval '1 day'", {
        createdTo: query.createdTo,
      });
    }

    const [filas, total] = await qb.getManyAndCount();
    const nombres = await this.nombresDe(filas);

    return buildPaginatedResponse(
      filas.map((fila) =>
        ComplaintResponseDto.fromEntity(fila, nombres.get(fila.id)!),
      ),
      total,
      page,
      limit,
    );
  }

  async findOne(id: string): Promise<ComplaintResponseDto> {
    const queja = await this.exigirQueja(id);
    const nombres = await this.nombresDe([queja]);
    const dto = ComplaintResponseDto.fromEntity(queja, nombres.get(queja.id)!);

    const eventos = await this.eventRepository.find({
      where: { complaintId: id },
      order: { createdAt: 'ASC' },
    });
    const autores = await this.nombresDeUsuarios(
      eventos.map((evento) => evento.userId),
    );
    dto.events = eventos.map((evento) =>
      ComplaintEventResponseDto.fromEntity(
        evento,
        autores.get(evento.userId) ?? null,
      ),
    );

    return dto;
  }

  async update(
    id: string,
    dto: UpdateComplaintDto,
    userId: string,
  ): Promise<ComplaintResponseDto> {
    const queja = await this.exigirQueja(id);

    if (dto.motiveId && dto.motiveId !== queja.motiveId) {
      await this.exigirMotivo(dto.motiveId);
      queja.motiveId = dto.motiveId;
    }
    if (dto.description !== undefined) queja.description = dto.description;

    let asignacionNueva: string | null | undefined;
    if (dto.assignedUserId !== undefined) {
      const asignado = dto.assignedUserId.trim() || null;
      if (asignado) await this.exigirUsuario(asignado);
      if (asignado !== queja.assignedUserId) {
        queja.assignedUserId = asignado;
        asignacionNueva = asignado;
      }
    }

    await this.complaintRepository.save(queja);
    await this.anotar(id, userId, ComplaintEventKind.EDITADA, {});
    if (asignacionNueva !== undefined) {
      await this.anotar(id, userId, ComplaintEventKind.ASIGNADA, {
        note: asignacionNueva ? null : 'Queda sin asignar',
      });
    }

    return this.findOne(id);
  }

  /**
   * Mueve la queja de estado.
   *
   * `puedeCerrar` lo trae el controlador desde el permiso: pasar a «resuelta»
   * no es un paso más, es dar el caso por bueno, y eso se concede aparte de
   * registrar y gestionar.
   */
  async changeStatus(
    id: string,
    dto: ChangeComplaintStatusDto,
    userId: string,
    puedeCerrar: boolean,
  ): Promise<ComplaintResponseDto> {
    const queja = await this.exigirQueja(id);

    if (dto.status === queja.status) {
      throw new BadRequestException(`La queja ya está "${queja.status}"`);
    }
    if (!TRANSICIONES[queja.status].includes(dto.status)) {
      throw new BadRequestException(
        `Una queja "${queja.status}" no puede pasar a "${dto.status}"`,
      );
    }
    if (dto.status === ComplaintStatus.RESUELTA) {
      if (!puedeCerrar) {
        throw new ForbiddenException(
          'Hace falta el permiso para cerrar quejas',
        );
      }
      if (!dto.note?.trim()) {
        throw new BadRequestException(
          'Di cómo se resolvió: hace falta para el informe y para quien atienda la próxima llamada',
        );
      }
    }

    const anterior = queja.status;
    queja.status = dto.status;
    if (dto.status === ComplaintStatus.RESUELTA) {
      queja.resolution = dto.note!.trim();
      queja.resolvedAt = new Date();
    } else {
      // Reabrir borra el cierre anterior: dejarlo puesto haría leer como
      // resuelta una queja que volvió a estar viva.
      queja.resolution = null;
      queja.resolvedAt = null;
    }
    await this.complaintRepository.save(queja);

    await this.anotar(id, userId, ComplaintEventKind.ESTADO, {
      fromStatus: anterior,
      toStatus: dto.status,
      note: dto.note?.trim() || null,
    });

    return this.findOne(id);
  }

  async addNote(
    id: string,
    note: string,
    userId: string,
  ): Promise<ComplaintResponseDto> {
    await this.exigirQueja(id);
    await this.anotar(id, userId, ComplaintEventKind.NOTA, { note });
    return this.findOne(id);
  }

  /** Cuántas quejas tiene cada pedido, para marcarlos en el panel. */
  async countByOrders(orderIds: string[]): Promise<Map<string, number>> {
    if (!orderIds.length) return new Map();
    const filas = await this.complaintRepository
      .createQueryBuilder('c')
      .select('c.orderId', 'order_id')
      .addSelect('COUNT(*)', 'total')
      .where('c.orderId IN (:...orderIds)', { orderIds })
      .groupBy('c.orderId')
      .getRawMany<{ order_id: string; total: string }>();
    return new Map(filas.map((f) => [f.order_id, Number(f.total)]));
  }

  // ---------------- Dentro de casa ----------------

  private async anotar(
    complaintId: string,
    userId: string,
    kind: ComplaintEventKind,
    datos: {
      fromStatus?: ComplaintStatus;
      toStatus?: ComplaintStatus;
      note?: string | null;
    },
  ): Promise<void> {
    await this.eventRepository.save(
      this.eventRepository.create({
        complaintId,
        userId,
        kind,
        fromStatus: datos.fromStatus ?? null,
        toStatus: datos.toStatus ?? null,
        note: datos.note ?? null,
      }),
    );
  }

  private async exigirQueja(id: string): Promise<Complaint> {
    const queja = await this.complaintRepository.findOne({ where: { id } });
    if (!queja) throw new NotFoundException(`No existe la queja "${id}"`);
    return queja;
  }

  private async exigirMotivo(motiveId: string): Promise<void> {
    const motivo = await this.nomenclatorsService.findActiveOption(
      COMPLAINT_MOTIVE_CATEGORY,
      motiveId,
    );
    if (!motivo) {
      throw new BadRequestException(
        'Ese motivo de queja no existe o está inactivo',
      );
    }
  }

  private async exigirCliente(clientId: string): Promise<void> {
    const existe = await this.clientRepository.exists({
      where: { id: clientId },
    });
    if (!existe) throw new BadRequestException('Ese cliente no existe');
  }

  /**
   * El pedido tiene que ser del cliente de la queja.
   *
   * Sin esto se podría colgar la queja de un pedido ajeno, y entonces «este
   * pedido generó una queja» señalaría al cliente equivocado.
   */
  private async exigirPedidoDelCliente(
    orderId: string,
    clientId: string,
  ): Promise<void> {
    const pedido = await this.orderRepository.findOne({
      where: { id: orderId },
    });
    if (!pedido) throw new BadRequestException('Ese pedido no existe');
    if (pedido.clientId !== clientId) {
      throw new BadRequestException('Ese pedido no es de este cliente');
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
        [usuario.firstName, usuario.lastName].filter(Boolean).join(' ') || null,
      ]),
    );
  }

  /** Las etiquetas de varias quejas en cuatro consultas, nunca una por fila. */
  private async nombresDe(
    quejas: Complaint[],
  ): Promise<Map<string, ComplaintNames>> {
    if (!quejas.length) return new Map();

    const etiquetas = await this.nomenclatorsService.labelsFor(
      quejas.map((queja) => queja.motiveId),
    );

    const clientIds = [...new Set(quejas.map((queja) => queja.clientId))];
    const clientes = clientIds.length
      ? await this.clientRepository.find({ where: { id: In(clientIds) } })
      : [];
    const nombreDelCliente = new Map(
      clientes.map((cliente) => [
        cliente.id,
        [cliente.firstName, cliente.lastName].filter(Boolean).join(' ') ||
          cliente.email ||
          null,
      ]),
    );

    const orderIds = [
      ...new Set(
        quejas
          .map((queja) => queja.orderId)
          .filter((id): id is string => Boolean(id)),
      ),
    ];
    const pedidos = orderIds.length
      ? await this.orderRepository.find({ where: { id: In(orderIds) } })
      : [];
    const numeroDelPedido = new Map(
      pedidos.map((pedido) => [pedido.id, pedido.orderNumber]),
    );

    const asignados = await this.nombresDeUsuarios(
      quejas
        .map((queja) => queja.assignedUserId)
        .filter((id): id is string => Boolean(id)),
    );

    return new Map(
      quejas.map((queja) => [
        queja.id,
        {
          motiveLabel: etiquetas.get(queja.motiveId) ?? null,
          clientName: nombreDelCliente.get(queja.clientId) ?? null,
          orderNumber: queja.orderId
            ? (numeroDelPedido.get(queja.orderId) ?? null)
            : null,
          assignedUserName: queja.assignedUserId
            ? (asignados.get(queja.assignedUserId) ?? null)
            : null,
        },
      ]),
    );
  }
}
