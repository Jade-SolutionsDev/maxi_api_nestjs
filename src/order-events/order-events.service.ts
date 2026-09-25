import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, In, Repository } from 'typeorm';
import { Client } from '../clients/entities/client.entity';
import { User } from '../users/entities/user.entity';
import { OrderEventResponseDto } from './dto/order-event-response.dto';
import {
  OrderEvent,
  OrderEventActor,
  OrderEventKind,
} from './entities/order-event.entity';

export interface RecordOrderEvent {
  orderId: string;
  kind: OrderEventKind;
  /** Quién: un usuario del admin, un cliente, o nadie (sistema). */
  actor:
    | { userId: string }
    | { clientId: string }
    | { system: true; reason?: string };
  field?: string | null;
  previousValue?: string | null;
  nextValue?: string | null;
  reason?: string | null;
  meta?: Record<string, unknown> | null;
}

/**
 * Escribe y lee el historial de un pedido.
 *
 * `record` acepta el `EntityManager` de la transacción en curso para que el
 * evento entre y salga con el cambio que describe: si la transacción se
 * deshace, el evento también. Fuera de transacción se pasa `null`.
 *
 * Registrar nunca debe tumbar la operación principal: un fallo aquí se
 * registra en el log y se traga. Perder una línea de historial es malo;
 * perder un cobro porque el historial falló sería peor.
 */
@Injectable()
export class OrderEventsService {
  private readonly logger = new Logger(OrderEventsService.name);

  constructor(
    @InjectRepository(OrderEvent)
    private readonly eventRepository: Repository<OrderEvent>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(Client)
    private readonly clientRepository: Repository<Client>,
  ) {}

  async record(
    manager: EntityManager | null,
    event: RecordOrderEvent,
  ): Promise<void> {
    const repo = manager
      ? manager.getRepository(OrderEvent)
      : this.eventRepository;
    const actor = event.actor;
    const row = repo.create({
      orderId: event.orderId,
      kind: event.kind,
      actorKind:
        'userId' in actor
          ? OrderEventActor.ADMIN
          : 'clientId' in actor
            ? OrderEventActor.CLIENT
            : OrderEventActor.SYSTEM,
      actorUserId: 'userId' in actor ? actor.userId : null,
      actorClientId: 'clientId' in actor ? actor.clientId : null,
      field: event.field ?? null,
      previousValue: event.previousValue ?? null,
      nextValue: event.nextValue ?? null,
      reason:
        event.reason ?? ('system' in actor ? (actor.reason ?? null) : null),
      meta: event.meta ?? null,
    });
    try {
      await repo.save(row);
    } catch (err) {
      this.logger.error(
        `Could not record ${event.kind} for order ${event.orderId}`,
        err instanceof Error ? err.stack : String(err),
      );
    }
  }

  /** Historial completo de un pedido, del más antiguo al más reciente. */
  async listForOrder(orderId: string): Promise<OrderEventResponseDto[]> {
    const events = await this.eventRepository.find({
      where: { orderId },
      order: { createdAt: 'ASC' },
    });
    if (events.length === 0) return [];

    const userIds = [
      ...new Set(
        events.map((e) => e.actorUserId).filter((id): id is string => !!id),
      ),
    ];
    const clientIds = [
      ...new Set(
        events.map((e) => e.actorClientId).filter((id): id is string => !!id),
      ),
    ];
    const [users, clients] = await Promise.all([
      userIds.length
        ? this.userRepository.find({
            where: { id: In(userIds) },
            withDeleted: true,
          })
        : [],
      clientIds.length
        ? this.clientRepository.find({
            where: { id: In(clientIds) },
            withDeleted: true,
          })
        : [],
    ]);
    const names = new Map<string, string>();
    for (const u of users) {
      names.set(u.id, fullName(u.firstName, u.lastName) ?? u.email ?? u.id);
    }
    for (const c of clients) {
      names.set(c.id, fullName(c.firstName, c.lastName) ?? c.email ?? c.id);
    }
    return events.map((e) =>
      OrderEventResponseDto.fromEntity(
        e,
        (e.actorUserId && names.get(e.actorUserId)) ||
          (e.actorClientId && names.get(e.actorClientId)) ||
          null,
      ),
    );
  }
}

const fullName = (
  first: string | null | undefined,
  last: string | null | undefined,
): string | null => {
  const name = [first, last].filter(Boolean).join(' ').trim();
  return name.length > 0 ? name : null;
};
