import { DataSource } from 'typeorm';
import { Category } from '../src/categories/entities/category.entity';
import { Municipality } from '../src/geography/entities/municipality.entity';
import { Province } from '../src/geography/entities/province.entity';
import { Product } from '../src/products/entities/product.entity';
import { Inventory } from '../src/inventory/entities/inventory.entity';
import { StockLocation } from '../src/stock-locations/entities/stock-location.entity';
import {
  CoverageType,
  StockLocationCoverage,
} from '../src/stock-locations/entities/stock-location-coverage.entity';
import { StockLocationGrocer } from '../src/stock-locations/entities/stock-location-grocer.entity';
import { Role, User } from '../src/users/entities/user.entity';

/**
 * Additive seed for testing the Inventory feature: ensures a spread of storages
 * (one DELIBERATELY disabled, so its stock counts toward `real` but not
 * `available`) and distributes stock for every active product across a few of
 * them. Idempotent — locations keyed by name, inventory by (location, product);
 * safe to re-run, never drops data. Geography must already be seeded (boot the
 * app once). Reserved stock comes from orders — run `pnpm run seed:orders` too.
 *
 * Run: pnpm run seed:inventory
 */
const DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgres://maxihabana:maxihabana@localhost:5432/maxihabana';

const dataSource = new DataSource({
  type: 'postgres',
  url: DATABASE_URL,
  entities: [
    Province,
    Municipality,
    StockLocation,
    StockLocationCoverage,
    StockLocationGrocer,
    Inventory,
    Product,
    Category,
    User,
  ],
  synchronize: false,
});

const LOCATION_SEEDS: {
  name: string;
  provinceCodes: string[];
  isActive: boolean;
}[] = [
  { name: 'Almacén Central La Habana', provinceCodes: ['CU-03', 'CU-15'], isActive: true },
  { name: 'Almacén Holguín', provinceCodes: ['CU-11'], isActive: true },
  { name: 'Almacén Santiago de Cuba', provinceCodes: ['CU-13'], isActive: true },
  { name: 'Almacén Villa Clara', provinceCodes: ['CU-05'], isActive: true },
  { name: 'Almacén en mantenimiento (deshabilitado)', provinceCodes: ['CU-01'], isActive: false },
];

async function main() {
  await dataSource.initialize();
  const provinceRepo = dataSource.getRepository(Province);
  const locationRepo = dataSource.getRepository(StockLocation);
  const coverageRepo = dataSource.getRepository(StockLocationCoverage);
  const grocerRepo = dataSource.getRepository(StockLocationGrocer);
  const inventoryRepo = dataSource.getRepository(Inventory);
  const productRepo = dataSource.getRepository(Product);
  const userRepo = dataSource.getRepository(User);

  const provinces = await provinceRepo.find();
  if (provinces.length === 0) {
    console.error(
      'Geography not seeded yet. Start the backend once (bootstrap seeds provinces) and retry.',
    );
    await dataSource.destroy();
    process.exit(1);
  }
  const provinceIdByCode = new Map(provinces.map((p) => [p.code, p.id]));
  const grocer = await userRepo.findOne({ where: { role: Role.GROCER } });

  // 1) Ensure the storages + coverage (+ grocer assignment on active ones).
  const locations: StockLocation[] = [];
  let createdLoc = 0;
  for (const seed of LOCATION_SEEDS) {
    let loc = await locationRepo.findOne({
      where: { name: seed.name },
      withDeleted: true,
    });
    if (!loc) {
      loc = await locationRepo.save(
        locationRepo.create({ name: seed.name, isActive: seed.isActive }),
      );
      const provinceIds = seed.provinceCodes
        .map((code) => provinceIdByCode.get(code))
        .filter((id): id is string => Boolean(id));
      await coverageRepo.save(
        provinceIds.map((provinceId) =>
          coverageRepo.create({
            coverageType: CoverageType.PROVINCE,
            provinceId,
            municipalityId: null,
            locationId: loc!.id,
          }),
        ),
      );
      if (grocer && seed.isActive) {
        await grocerRepo.save(
          grocerRepo.create({ locationId: loc.id, grocerId: grocer.id }),
        );
      }
      createdLoc += 1;
    }
    locations.push(loc);
  }
  const activeLocs = locations.filter((l) => l.isActive && !l.deletedAt);
  const disabledLoc = locations.find((l) => !l.isActive);

  // 2) Distribute stock: every active product gets rows in 2 active storages,
  //    and every 3rd product also holds stock in the disabled storage (so its
  //    real > available). Idempotent per (location, product).
  const products = await productRepo.find({ where: { isActive: true } });
  const existing = await inventoryRepo.find();
  const seen = new Set(existing.map((r) => `${r.locationId}:${r.productId}`));

  let createdInv = 0;
  let skippedInv = 0;
  let disabledRows = 0;
  for (let i = 0; i < products.length; i += 1) {
    const product = products[i];
    const picks: StockLocation[] = [
      activeLocs[i % activeLocs.length],
      activeLocs[(i + 1) % activeLocs.length],
    ];
    if (disabledLoc && i % 3 === 0) picks.push(disabledLoc);

    const unique = [...new Map(picks.map((l) => [l.id, l])).values()];
    for (const loc of unique) {
      const key = `${loc.id}:${product.id}`;
      if (seen.has(key)) {
        skippedInv += 1;
        continue;
      }
      // Deterministic 20..99 so re-runs are stable.
      const quantity = 20 + ((i * 7 + loc.name.length) % 80);
      await inventoryRepo.save(
        inventoryRepo.create({
          locationId: loc.id,
          productId: product.id,
          quantity,
          reservedQuantity: 0,
        }),
      );
      seen.add(key);
      createdInv += 1;
      if (loc === disabledLoc) disabledRows += 1;
    }
  }

  console.log(
    `Storages: ${createdLoc} created, ${LOCATION_SEEDS.length - createdLoc} already existed.`,
  );
  console.log(
    `Inventory: ${createdInv} rows created (${disabledRows} in the disabled storage), ${skippedInv} already existed, across ${products.length} active products.`,
  );
  await dataSource.destroy();
}

void main();
