import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Order } from '../orders/entities/order.entity';
import type {
  CollectionRowDto,
  CollectionsResponseDto,
} from './dto/collection-response.dto';
import type {
  CollectionsQueryDto,
  EstadoDeCobro,
  OrigenDelCobro,
} from './dto/collections-query.dto';

/** Una fila cruda, tal como la devuelve el SQL. */
interface FilaCruda {
  order_id: string;
  order_number: string | null;
  client_id: string | null;
  client_name: string | null;
  fecha: Date;
  amount: string;
  method: string | null;
  estado: EstadoDeCobro;
  origen: OrigenDelCobro;
  descuadre: boolean;
  reference: string | null;
}

/**
 * El dinero que entró por las ventas de la tienda. MxH-0063.
 *
 * **Una fila por pedido, conciliada contra `payment_charges`.** No es una lista
 * de cobros: es la lista de pedidos con actividad de pago, con su cobro al lado
 * si lo hay. La diferencia importa, y la decidió así la otra sesión con un
 * argumento que no tenía réplica:
 *
 * - Leyendo solo `payment_charges`, los pedidos que alguien marcó pagados sin
 *   que quedara registro **no aparecerían en absoluto** — y son justo los que
 *   hay que ver.
 * - Leyendo solo el pedido, aparecen todos pero la pantalla **deja de
 *   distinguir** «cobré y lo registré» de «cobré y no lo registré».
 *
 * Así que se concilian las dos fuentes y **se enseña el descuadre** en vez de
 * esconderlo. Una fila que diga «cobrado · sin cobro registrado» es exactamente
 * la información que la tarjeta pide: «hay que poder saber qué entró de verdad
 * y qué apuntó alguien».
 *
 * Medido en staging el 12-oct-2026: de 31 pedidos cobrados, **29 no tienen
 * ningún cobro con éxito detrás** — 70.245 de 70.566 USD. Eso no es un fallo
 * de esta pantalla, es lo que esta pantalla sirve para ver.
 */
@Injectable()
export class CollectionsService {
  constructor(
    @InjectRepository(Order)
    private readonly orderRepository: Repository<Order>,
  ) {}

  /**
   * `origen` sale del **proveedor del cobro**, no de su éxito.
   *
   * Es un error fácil y lo cometí: clasificar por `bool_or(status='SUCCEEDED')`
   * etiquetaba como «manual» un cobro de TropiPay que todavía esperaba al
   * cliente. Quién inició el cobro y si cuadra son **dos cosas
   * independientes**, y la pantalla necesita las dos por separado: un cobro
   * iniciado en la pasarela que alguien acabó marcando a mano —porque el aviso
   * nunca llegó— es `pasarela` + `descuadre`, y eso se lee distinto de un pago
   * manual bien registrado.
   */
  private readonly SELECCION = `
    WITH cobro AS (
      SELECT c.order_id,
             (array_agg(c.provider  ORDER BY (c.status = 'SUCCEEDED') DESC, c.created_at DESC))[1] AS provider,
             (array_agg(c.reference ORDER BY (c.status = 'SUCCEEDED') DESC, c.created_at DESC))[1] AS reference,
             bool_or(c.status = 'SUCCEEDED') AS con_exito
        FROM payment_charges c
       GROUP BY c.order_id
    ),
    base AS (
      SELECT
        o.id                                            AS order_id,
        o.order_number,
        o.client_id,
        nullif(trim(coalesce(cl."firstName", '') || ' ' || coalesce(cl."lastName", '')), '') AS client_name,
        coalesce(o.paid_at, o.created_at)               AS fecha,
        o.total::text                                   AS amount,
        coalesce(co.provider, pm.codigo)                AS method,
        CASE o.payment_status
          WHEN 'paid'     THEN 'cobrado'
          WHEN 'refunded' THEN 'reembolsado'
          ELSE                 'pendiente'
        END                                             AS estado,
        CASE
          WHEN co.order_id IS NULL      THEN 'manual'
          WHEN co.provider = 'manual'   THEN 'manual'
          ELSE                               'pasarela'
        END                                             AS origen,
        (o.payment_status = 'paid' AND coalesce(co.con_exito, false) = false) AS descuadre,
        co.reference
        FROM orders o
        LEFT JOIN cobro co ON co.order_id = o.id
        LEFT JOIN clients cl ON cl.id = o.client_id
        LEFT JOIN LATERAL (
          SELECT e.meta->>'paymentMethod' AS codigo
            FROM order_events e
           WHERE e.order_id = o.id
             AND e.meta ? 'paymentMethod'
             AND nullif(e.meta->>'paymentMethod', '') IS NOT NULL
           ORDER BY e.created_at DESC
           LIMIT 1
        ) pm ON true
       WHERE o.deleted_at IS NULL
         AND (o.payment_status IN ('paid', 'refunded') OR co.order_id IS NOT NULL)
    )`;

  async find(query: CollectionsQueryDto): Promise<CollectionsResponseDto> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 50;

    const condiciones: string[] = [];
    const params: unknown[] = [];
    const añade = (sql: string, valor: unknown) => {
      params.push(valor);
      condiciones.push(sql.replace('$?', `$${params.length}`));
    };

    if (query.from) añade('fecha >= $?::timestamptz', query.from);
    // El día entero: `to` es inclusive, así que se compara contra el día
    // siguiente. Con `<= $to` un filtro «hasta el 12» se dejaba fuera todo lo
    // cobrado ese 12 después de medianoche, que es todo.
    if (query.to) añade("fecha < ($?::date + interval '1 day')", query.to);
    if (query.status) añade('estado = $?', query.status);
    if (query.origin) añade('origen = $?', query.origin);
    if (query.method) añade('method = $?', query.method);

    const donde = condiciones.length
      ? `WHERE ${condiciones.join(' AND ')}`
      : '';

    const filas: FilaCruda[] = await this.orderRepository.manager.query(
      `${this.SELECCION}
       SELECT * FROM base ${donde}
        ORDER BY fecha DESC, order_number DESC
        LIMIT ${limit} OFFSET ${(page - 1) * limit}`,
      params,
    );

    // Los totales se calculan sobre **todo el periodo filtrado**, no sobre la
    // página: un total que solo sume lo que se ve en pantalla es un total que
    // engaña en cuanto hay más de una página.
    const [totales]: {
      collected: string | null;
      pending: string | null;
      refunded: string | null;
      unreconciled_count: number;
      unreconciled_amount: string | null;
    }[] = await this.orderRepository.manager.query(
      `${this.SELECCION}
       SELECT
         sum(amount::numeric) FILTER (WHERE estado = 'cobrado')::text     AS collected,
         sum(amount::numeric) FILTER (WHERE estado = 'pendiente')::text   AS pending,
         sum(amount::numeric) FILTER (WHERE estado = 'reembolsado')::text AS refunded,
         count(*) FILTER (WHERE descuadre)::int                           AS unreconciled_count,
         sum(amount::numeric) FILTER (WHERE descuadre)::text              AS unreconciled_amount
         FROM base ${donde}`,
      params,
    );

    const [{ total }]: { total: number }[] =
      await this.orderRepository.manager.query(
        `${this.SELECCION} SELECT count(*)::int AS total FROM base ${donde}`,
        params,
      );

    const cero = (valor: string | null) => valor ?? '0.00';

    return {
      rows: filas.map(
        (f): CollectionRowDto => ({
          orderId: f.order_id,
          orderNumber: f.order_number,
          clientId: f.client_id,
          clientName: f.client_name,
          date: f.fecha,
          amount: f.amount,
          method: f.method,
          status: f.estado,
          origin: f.origen,
          unreconciled: f.descuadre,
          reference: f.reference,
        }),
      ),
      totals: {
        collected: cero(totales.collected),
        pending: cero(totales.pending),
        refunded: cero(totales.refunded),
        unreconciledCount: totales.unreconciled_count,
        unreconciledAmount: cero(totales.unreconciled_amount),
      },
      total,
      page,
      limit,
    };
  }
}
