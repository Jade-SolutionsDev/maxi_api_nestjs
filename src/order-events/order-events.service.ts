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

  /**
   * El método con el que se cobró cada pedido **según su historial**, para los
   * pedidos que no dejaron ningún intento en `payment_charges`.
   *
   * Un cobro apuntado a mano al crear el pedido desde el panel marca el pedido
   * como pagado y escribe este evento, pero no abre ningún intento contra una
   * pasarela — porque no lo hubo. Sin este respaldo, ese pedido sale sin
   * método de pago en el listado y el filtro no lo encuentra (MxH-0133,
   * punto 3).
   *
   * Solo cuenta `payment_status_changed`: el `created` también lleva el método
   * que el cliente **eligió**, y un pedido pendiente que nunca llegó a pagar
   * no tiene método con el que se cobrara. Decirlo sería inventar un cobro:
   * en staging hay 14 pedidos así.
   */
  async latestPaymentMethodsFor(
    orderIds: string[],
  ): Promise<Map<string, string>> {
    if (orderIds.length === 0) return new Map();

    const rows = await this.eventRepository
      .createQueryBuilder('event')
      // Las columnas van entrecomilladas y no como `event.propiedad` porque
      // `DISTINCT ON` exige que su expresión sea **la misma cadena** que abre
      // el `ORDER BY`, y ahí TypeORM no sustituye alias.
      .select('DISTINCT ON ("event"."order_id") "event"."order_id"', 'orderId')
      .addSelect(`"event"."meta"->>'paymentMethod'`, 'code')
      .where('event.orderId IN (:...orderIds)', { orderIds })
      .andWhere('event.kind = :kind', {
        kind: OrderEventKind.PAYMENT_STATUS_CHANGED,
      })
      // `->>` ya da NULL cuando la clave no está; el `nullif` descarta además
      // el método guardado como cadena vacía.
      .andWhere(`nullif("event"."meta"->>'paymentMethod', '') IS NOT NULL`)
      // Mismo desempate que `latestChargesFor`: dos eventos del mismo instante
      // dejaban el «último» al azar del orden que devolviera la base.
      .orderBy('"event"."order_id"')
      .addOrderBy('event.createdAt', 'DESC')
      .addOrderBy('event.id', 'DESC')
      .getRawMany<{ orderId: string; code: string }>();

    return new Map(rows.map((r) => [r.orderId, r.code]));
  }
}

const fullName = (
  first: string | null | undefined,
  last: string | null | undefined,
): string | null => {
  const name = [first, last].filter(Boolean).join(' ').trim();
  return name.length > 0 ? name : null;
};
