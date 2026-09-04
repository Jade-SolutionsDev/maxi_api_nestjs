import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import {
  DashboardClientsRow,
  DashboardOrdersRow,
  DashboardPeriodDto,
  DashboardProductsRow,
  DashboardStatsResponseDto,
} from './dto/dashboard-stats-response.dto';

const DAY_MS = 24 * 60 * 60 * 1000;

// $1 = previousFrom, $2 = from, $3 = to. The same three parameters feed all
// three statements, so the windows they report are mutually consistent.

/**
 * One pass over the 2N-day slice: FILTER splits it into the two windows, so the
 * planner reads the range once instead of four times.
 *
 * `'cancelled'` is an unquoted literal so Postgres casts it to the column's own
 * enum type; binding it as a parameter would need an explicit cast.
 */
const ORDERS_SQL = `
  SELECT
    COALESCE(SUM(o.total) FILTER (
      WHERE o.created_at >= $2 AND o.status <> 'cancelled'), 0) AS revenue_current,
    COALESCE(SUM(o.total) FILTER (
      WHERE o.created_at <  $2 AND o.status <> 'cancelled'), 0) AS revenue_previous,
    COUNT(*) FILTER (WHERE o.created_at >= $2)::int AS orders_current,
    COUNT(*) FILTER (WHERE o.created_at <  $2)::int AS orders_previous
  FROM orders o
  WHERE o.deleted_at IS NULL
    AND o.created_at >= $1
    AND o.created_at <  $3
`;

/**
 * `active` is a snapshot of the whole catalogue, so this statement has no date
 * range in its WHERE — the window only shapes the two "new in period" counts,
 * which feed the badge.
 */
const PRODUCTS_SQL = `
  SELECT
    COUNT(*) FILTER (WHERE p.is_active)::int AS active,
    COUNT(*) FILTER (
      WHERE p.is_active AND p.created_at >= $2 AND p.created_at < $3)::int AS new_current,
    COUNT(*) FILTER (
      WHERE p.is_active AND p.created_at >= $1 AND p.created_at < $2)::int AS new_previous
  FROM products p
  WHERE p.deleted_at IS NULL
`;

/**
 * `admin_invite_pending` rows are customers the backoffice provisioned from an
 * invitation nobody has accepted yet; counting them would let the KPI be
 * inflated from the inside. `is_active` is deliberately NOT filtered: someone
 * who registered in the window registered in it even if they were deactivated
 * afterwards, and filtering on a current-state flag would make historical
 * windows drift.
 */
const CLIENTS_SQL = `
  SELECT
    COUNT(*) FILTER (WHERE c.created_at >= $2 AND c.created_at < $3)::int AS new_current,
    COUNT(*) FILTER (WHERE c.created_at >= $1 AND c.created_at < $2)::int AS new_previous
  FROM clients c
  WHERE c.deleted_at IS NULL
    AND c.admin_invite_pending = false
`;

/**
 * The four figures on the admin landing page, each with the same figure over
 * the previous window so the UI can draw a trend.
 *
 * Two conventions differ on purpose:
 *
 * - `revenue` EXCLUDES cancelled orders. It is money, and a cancelled order is
 *   not money. It deliberately does NOT require `payment_status = 'paid'`:
 *   payments are still settled by hand (PATCH /orders/:id/payment-status), so
 *   that filter would undercount everything nobody has got around to yet.
 * - `orders` INCLUDES cancelled ones. It answers "how much demand arrived", and
 *   a count that quietly disagrees with the total on the /orders list is worse
 *   than one that counts a cancellation.
 *
 * Windows are rolling N x 24h spans, not calendar days, and all three
 * statements receive the SAME three instants captured once in JS. That keeps
 * every boundary out of the database's own timezone (the columns are
 * `timestamptz`, the process is pinned to UTC in main.ts) and makes the whole
 * thing testable with fake timers.
 *
 * Every statement filters `deleted_at IS NULL` by hand: these are raw queries,
 * so TypeORM's soft-delete handling does not apply.
 */
@Injectable()
export class DashboardService {
  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {}

  async getStats(days = 30): Promise<DashboardStatsResponseDto> {
    const to = new Date();
    const from = new Date(to.getTime() - days * DAY_MS);
    const previousFrom = new Date(to.getTime() - 2 * days * DAY_MS);
    const params = [previousFrom, from, to];

    const [orderRows, productRows, clientRows] = await Promise.all([
      this.dataSource.query<DashboardOrdersRow[]>(ORDERS_SQL, params),
      this.dataSource.query<DashboardProductsRow[]>(PRODUCTS_SQL, params),
      this.dataSource.query<DashboardClientsRow[]>(CLIENTS_SQL, params),
    ]);

    const period: DashboardPeriodDto = {
      days,
      previousFrom: previousFrom.toISOString(),
      from: from.toISOString(),
      to: to.toISOString(),
    };

    return DashboardStatsResponseDto.fromRows(
      period,
      orderRows[0],
      productRows[0],
      clientRows[0],
    );
  }
}
