/** The single window the ranking was measured over, as ISO-8601 UTC instants. */
export class DashboardWindowDto {
  days: number;
  /** Start of the window (inclusive). */
  from: string;
  /** End of the window (exclusive): the instant the ranking was taken. */
  to: string;
}

/** Raw row as Postgres returns it: `::int` on the sum, so it arrives a number. */
export interface DashboardTopProductRow {
  product_id: string;
  name: string;
  image_url: string | null;
  sold: number;
}

export class DashboardTopProductDto {
  id: string;
  /** The product's CURRENT name, not the snapshot stored on the order item. */
  name: string;
  imageUrl: string | null;
  /** Units sold in the window; cancelled and unpaid orders excluded. */
  sold: number;
}

export class DashboardTopProductsResponseDto {
  period: DashboardWindowDto;
  /** Ordered by units sold, descending. At most `limit` entries. */
  items: DashboardTopProductDto[];

  static fromRows(
    period: DashboardWindowDto,
    rows: DashboardTopProductRow[],
  ): DashboardTopProductsResponseDto {
    const dto = new DashboardTopProductsResponseDto();
    dto.period = period;
    dto.items = rows.map((row) => ({
      id: row.product_id,
      name: row.name,
      imageUrl: row.image_url,
      sold: Number(row.sold),
    }));
    return dto;
  }
}
