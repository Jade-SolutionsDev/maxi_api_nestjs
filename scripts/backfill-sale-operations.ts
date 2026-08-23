import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';

/**
 * Backfill the movement ledger with historical SALES.
 *
 * Confirmed store orders decrement physical stock via `inventory_reservations`
 * but (before fix/sales-in-movement-ledger) left no `inventory_operations` row,
 * so past sales are missing from the ledger. This writes one OUT operation per
 * (confirmed order, storage) from the surviving reservation rows.
 *
 * Idempotent + additive: skips any (order, location) that already has an OUT
 * operation (so it also skips orders confirmed after the code fix), never drops
 * data. Safe to re-run.
 *
 * Attribution: reservations carry no actor, so backfilled ops are stamped with
 * a SUPER_ADMIN (fallback ADMIN) user and note 'backfill'.
 *
 * Not covered: historical confirmed-then-cancelled restocks (IN) — those
 * reservations now read `cancelled`, indistinguishable from released holds.
 *
 * Run: pnpm run backfill:sale-operations
 */
const DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgres://maxihabana:maxihabana@localhost:5432/maxihabana';

const dataSource = new DataSource({
  type: 'postgres',
  url: DATABASE_URL,
  entities: [],
  synchronize: false,
});

interface ReservationRow {
  order_id: string;
  location_id: string;
  product_id: string;
  qty: string;
}

async function main() {
  await dataSource.initialize();

  const actor: { id: string }[] = await dataSource.query(
    `SELECT id FROM users
      WHERE role IN ('SUPER_ADMIN', 'ADMIN') AND deleted_at IS NULL
      ORDER BY CASE role WHEN 'SUPER_ADMIN' THEN 0 ELSE 1 END
      LIMIT 1`,
  );
  if (actor.length === 0) {
    console.error(
      'No SUPER_ADMIN/ADMIN user found to attribute backfilled sales to. ' +
        'Seed one (pnpm run seed:superadmin) and retry.',
    );
    await dataSource.destroy();
    process.exit(1);
  }
  const createdBy = actor[0].id;

  // Physical sale quantity per (order, location, product).
  const rows: ReservationRow[] = await dataSource.query(
    `SELECT order_id, location_id, product_id, SUM(quantity)::int AS qty
       FROM inventory_reservations
      WHERE status = 'confirmed'
      GROUP BY order_id, location_id, product_id`,
  );

  // Group into one operation per (order, location).
  const groups = new Map<string, { orderId: string; locationId: string; items: { productId: string; quantity: number }[] }>();
  for (const r of rows) {
    const key = `${r.order_id}:${r.location_id}`;
    const g =
      groups.get(key) ??
      { orderId: r.order_id, locationId: r.location_id, items: [] };
    g.items.push({ productId: r.product_id, quantity: Number(r.qty) });
    groups.set(key, g);
  }

  let created = 0;
  let skipped = 0;

  await dataSource.transaction(async (manager) => {
    for (const g of groups.values()) {
      const existing: { id: string }[] = await manager.query(
        `SELECT id FROM inventory_operations
          WHERE order_id = $1 AND location_id = $2 AND type = 'OUT'
          LIMIT 1`,
        [g.orderId, g.locationId],
      );
      if (existing.length > 0) {
        skipped += 1;
        continue;
      }

      const opId = randomUUID();
      await manager.query(
        `INSERT INTO inventory_operations
           (id, type, location_id, target_location_id, order_id, note, created_by)
         VALUES ($1, 'OUT', $2, NULL, $3, 'backfill', $4)`,
        [opId, g.locationId, g.orderId, createdBy],
      );
      for (const item of g.items) {
        await manager.query(
          `INSERT INTO inventory_operation_items (id, operation_id, product_id, quantity)
           VALUES ($1, $2, $3, $4)`,
          [randomUUID(), opId, item.productId, item.quantity],
        );
      }
      created += 1;
    }
  });

  console.log(
    `Backfill: ${created} OUT operation(s) created, ${skipped} already existed, ` +
      `across ${groups.size} (order, storage) group(s).`,
  );
  await dataSource.destroy();
}

void main();
