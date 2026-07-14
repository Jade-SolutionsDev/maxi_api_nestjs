import { DataSource } from 'typeorm';
import { Municipality } from '../src/geography/entities/municipality.entity';
import { Province } from '../src/geography/entities/province.entity';
import { StockLocation } from '../src/stock-locations/entities/stock-location.entity';
import {
  CoverageType,
  StockLocationCoverage,
} from '../src/stock-locations/entities/stock-location-coverage.entity';
import { StockLocationGrocer } from '../src/stock-locations/entities/stock-location-grocer.entity';
import { Role, User } from '../src/users/entities/user.entity';

/**
 * Additive seed for testing: inserts a couple of storages with coverage (and a
 * grocer assignment if a GROCER exists). Idempotent by name — safe to re-run,
 * never drops data. Geography must already be seeded (boot the app once).
 *
 * Run: pnpm run seed:stock-locations
 */
const DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgres://maxihabana:maxihabana@localhost:5432/maxihabana';

const dataSource = new DataSource({
  type: 'postgres',
  url: DATABASE_URL,
  entities: [
    StockLocation,
    StockLocationCoverage,
    StockLocationGrocer,
    Province,
    Municipality,
    User,
  ],
  synchronize: false,
});

async function main() {
  await dataSource.initialize();
  const provinceRepo = dataSource.getRepository(Province);
  const municipalityRepo = dataSource.getRepository(Municipality);
  const locationRepo = dataSource.getRepository(StockLocation);
  const coverageRepo = dataSource.getRepository(StockLocationCoverage);
  const grocerRepo = dataSource.getRepository(StockLocationGrocer);
  const userRepo = dataSource.getRepository(User);

  const habana = await provinceRepo.findOne({ where: { code: 'CU-03' } });
  const artemisa = await provinceRepo.findOne({ where: { code: 'CU-15' } });
  if (!habana || !artemisa) {
    console.error(
      'Geography not seeded yet. Start the backend once (bootstrap seeds provinces) and retry.',
    );
    await dataSource.destroy();
    process.exit(1);
  }

  const habanaMunicipalities = await municipalityRepo.find({
    where: { provinceId: habana.id },
    order: { name: 'ASC' },
    take: 3,
  });
  const grocer = await userRepo.findOne({ where: { role: Role.GROCER } });

  const seeds: {
    name: string;
    coverage: Array<Partial<StockLocationCoverage>>;
  }[] = [
    {
      name: 'Almacén Central La Habana',
      coverage: [
        {
          coverageType: CoverageType.PROVINCE,
          provinceId: habana.id,
          municipalityId: null,
        },
        {
          coverageType: CoverageType.PROVINCE,
          provinceId: artemisa.id,
          municipalityId: null,
        },
      ],
    },
    {
      name: 'Almacén Habana Vieja',
      coverage: habanaMunicipalities.map((m) => ({
        coverageType: CoverageType.MUNICIPALITY,
        provinceId: habana.id,
        municipalityId: m.id,
      })),
    },
  ];

  let created = 0;
  let skipped = 0;
  for (const seed of seeds) {
    const existing = await locationRepo.findOne({
      where: { name: seed.name },
      withDeleted: true,
    });
    if (existing) {
      skipped += 1;
      continue;
    }
    const location = await locationRepo.save(
      locationRepo.create({ name: seed.name, isActive: true }),
    );
    await coverageRepo.save(
      seed.coverage.map((c) => coverageRepo.create({ ...c, locationId: location.id })),
    );
    if (grocer) {
      await grocerRepo.save(
        grocerRepo.create({ locationId: location.id, grocerId: grocer.id }),
      );
    }
    created += 1;
  }

  console.log(
    `Seed complete: ${created} storages created, ${skipped} already existed.` +
      (grocer ? ` Assigned grocer ${grocer.email ?? grocer.id}.` : ''),
  );
  await dataSource.destroy();
}

void main();
