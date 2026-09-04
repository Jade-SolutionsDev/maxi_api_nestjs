/** One figure measured over the current window and over the previous one. */
export class DashboardMetricDto {
  current: number;
  previous: number;
}

export class DashboardProductsMetricDto extends DashboardMetricDto {
  /**
   * Active, non-deleted products right now. A snapshot, not a window — unlike
   * `current`/`previous`, which count the products that became available in
   * each window and only drive the trend badge.
   */
  active: number;
}

/** The two windows the figures were measured over, as ISO-8601 UTC instants. */
export class DashboardPeriodDto {
  days: number;
  /** Start of the previous window (inclusive). */
  previousFrom: string;
  /** Start of the current window (inclusive) = end of the previous one. */
  from: string;
  /** End of the current window (exclusive): the instant the stats were taken. */
  to: string;
}

/** Raw rows as Postgres returns them: numeric → string, ::int → number. */
export interface DashboardOrdersRow {
  revenue_current: string;
  revenue_previous: string;
  orders_current: number;
  orders_previous: number;
}

export interface DashboardProductsRow {
  active: number;
  new_current: number;
  new_previous: number;
}

export interface DashboardClientsRow {
  new_current: number;
  new_previous: number;
}

export class DashboardStatsResponseDto {
  period: DashboardPeriodDto;
  /** Money COLLECTED in the window: cancelled and unpaid orders excluded. */
  revenue: DashboardMetricDto;
  /** Orders placed in the window, cancellations INCLUDED (demand, not money). */
  orders: DashboardMetricDto;
  products: DashboardProductsMetricDto;
  /** Customers who registered in the window (pending invitations excluded). */
  clients: DashboardMetricDto;

  static fromRows(
    period: DashboardPeriodDto,
    orders: DashboardOrdersRow,
    products: DashboardProductsRow,
    clients: DashboardClientsRow,
  ): DashboardStatsResponseDto {
    const dto = new DashboardStatsResponseDto();
    dto.period = period;
    // numeric(12,2) arrives from pg as a string — the same Number() that
    // OrderResponseDto.fromEntity applies to order.total.
    dto.revenue = {
      current: Number(orders.revenue_current),
      previous: Number(orders.revenue_previous),
    };
    dto.orders = {
      current: Number(orders.orders_current),
      previous: Number(orders.orders_previous),
    };
    dto.products = {
      active: Number(products.active),
      current: Number(products.new_current),
      previous: Number(products.new_previous),
    };
    dto.clients = {
      current: Number(clients.new_current),
      previous: Number(clients.new_previous),
    };
    return dto;
  }
}
