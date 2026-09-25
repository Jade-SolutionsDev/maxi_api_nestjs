import {
  OrderEvent,
  OrderEventActor,
  OrderEventKind,
} from '../entities/order-event.entity';

/** Una línea del historial de un pedido, lista para pintar. */
export class OrderEventResponseDto {
  id: string;
  kind: OrderEventKind;
  actorKind: OrderEventActor;
  /** Nombre de quien actuó (admin o cliente); null para el sistema. */
  actorName: string | null;
  field: string | null;
  previousValue: string | null;
  nextValue: string | null;
  reason: string | null;
  meta: Record<string, unknown> | null;
  createdAt: Date;

  static fromEntity(
    event: OrderEvent,
    actorName: string | null,
  ): OrderEventResponseDto {
    const dto = new OrderEventResponseDto();
    dto.id = event.id;
    dto.kind = event.kind;
    dto.actorKind = event.actorKind;
    dto.actorName = actorName;
    dto.field = event.field;
    dto.previousValue = event.previousValue;
    dto.nextValue = event.nextValue;
    dto.reason = event.reason;
    dto.meta = event.meta;
    dto.createdAt = event.createdAt;
    return dto;
  }
}
