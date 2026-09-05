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
import {
  DashboardTopProductRow,
  DashboardTopProductsResponseDto,
} from './dto/dashboard-top-products-response.dto';

const DAY_MS = 24 * 60 * 60 * 1000;

const ORDERS_SQL = `
  SELECT
    COALESCE(SUM(o.total) FILTER (
      WHERE o.created_at >= $2
        AND o.status <> 'cancelled'
        AND o.payment_status = 'paid'), 0) AS revenue_current,
    COALESCE(SUM(o.total) FILTER (
      WHERE o.created_at <  $2
        AND o.status <> 'cancelled'
        AND o.payment_status = 'paid'), 0) AS revenue_previous,
    COUNT(*) FILTER (WHERE o.created_at >= $2)::int AS orders_current,
    COUNT(*) FILTER (WHERE o.created_at <  $2)::int AS orders_previous
  FROM orders o
  WHERE o.deleted_at IS NULL
    AND o.created_at >= $1
    AND o.created_at <  $3
`;

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

const CLIENTS_SQL = `
  SELECT
    COUNT(*) FILTER (WHERE c.created_at >= $2 AND c.created_at < $3)::int AS new_current,
    COUNT(*) FILTER (WHERE c.created_at >= $1 AND c.created_at < $2)::int AS new_previous
  FROM clients c
  WHERE c.deleted_at IS NULL
    AND c.admin_invite_pending = false
`;

const TOP_PRODUCTS_SQL = `
  SELECT
    oi.product_id AS product_id,
    p.name        AS name,
    p.image_url   AS image_url,
    COALESCE(SUM(oi.quantity), 0)::int AS sold,
    COALESCE(SUM(oi.line_total), 0)    AS revenue
  FROM order_items oi
  JOIN orders   o ON o.id = oi.order_id
  JOIN products p ON p.id = oi.product_id
  WHERE o.deleted_at IS NULL
    AND o.status <> 'cancelled'
    AND o.payment_status = 'paid'
    AND o.created_at >= $1
    AND o.created_at <  $2
  GROUP BY oi.product_id, p.name, p.image_url
  ORDER BY sold DESC, p.name ASC
  LIMIT $3
`;

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

  async getTopProducts(
    days = 30,
    limit = 5,
  ): Promise<DashboardTopProductsResponseDto> {
    const to = new Date();
    const from = new Date(to.getTime() - days * DAY_MS);

    const rows = await this.dataSource.query<DashboardTopProductRow[]>(
      TOP_PRODUCTS_SQL,
      [from, to, limit],
    );

    return DashboardTopProductsResponseDto.fromRows(
      { days, from: from.toISOString(), to: to.toISOString() },
      rows,
    );
  }
}
