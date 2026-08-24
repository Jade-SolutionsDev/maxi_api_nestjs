import { DataSource } from 'typeorm';
import { databaseConfig } from '../config/configuration';

/**
 * DataSource used ONLY by the TypeORM CLI (`migration:generate`, `migration:run`,
 * `migration:revert`). The running application builds its own connection in
 * AppModule; both read the URL from `databaseConfig()` so they can never
 * disagree about which database a migration lands on.
 *
 * There is no dotenv here on purpose — it is not a dependency of this project.
 * `databaseConfig()` already defaults to the local docker-compose database, and
 * any other target is passed inline: `DATABASE_URL=... pnpm migration:run`.
 */
export default new DataSource({
  type: 'postgres',
  url: databaseConfig().url,
  entities: ['src/**/*.entity.ts'],
  migrations: ['src/database/migrations/*.ts'],
  // Never true here. The CLI applies committed migrations; it does not get to
  // guess the schema from the entities.
  synchronize: false,
});
