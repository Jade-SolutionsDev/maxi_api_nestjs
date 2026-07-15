import * as readline from 'readline';
import { DataSource } from 'typeorm';
import { Role, User } from '../src/users/entities/user.entity';

const DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgres://maxihabana:maxihabana@localhost:5432/maxihabana';

const dataSource = new DataSource({
  type: 'postgres',
  url: DATABASE_URL,
  entities: [User],
  // Data-only: the table already exists (API owns the schema). Never emit DDL
  // against the target DB — this script only reads/updates a row.
  synchronize: false,
  // Render (and most managed Postgres) require TLS for external connections;
  // their cert isn't in Node's default CA bundle, hence rejectUnauthorized:false.
  // Local dev URLs stay plaintext.
  ssl: /render\.com|sslmode=require/.test(DATABASE_URL)
    ? { rejectUnauthorized: false }
    : false,
});

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function ask(question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => resolve(answer.trim()));
  });
}

async function main() {
  const clerkId = await ask('Superadmin clerkId: ');
  const email = await ask('Superadmin email: ');
  rl.close();

  if (!clerkId || !email) {
    console.error('clerkId and email are required.');
    process.exit(1);
  }

  await dataSource.initialize();
  const repository = dataSource.getRepository(User);

  // Match an existing account by clerkId OR email (both unique) so a user
  // auto-created by the Clerk webhook can be promoted rather than duplicated.
  const existing = await repository.findOne({
    where: [{ clerkId }, { email: email.toLowerCase() }],
    withDeleted: true,
  });

  if (existing) {
    const before = existing.role;
    existing.role = Role.SUPER_ADMIN;
    existing.isActive = true;
    existing.deletedAt = null; // restore if it had been soft-deleted
    await repository.save(existing);
    console.log(
      `Existing user "${existing.email ?? existing.clerkId}" promoted ${before} -> SUPER_ADMIN.`,
    );
  } else {
    const user = repository.create({
      clerkId,
      firstName: 'Super',
      lastName: 'Admin',
      email: email.toLowerCase(),
      role: Role.SUPER_ADMIN,
      isActive: true,
    });

    await repository.save(user);
    console.log(`Superadmin "${email}" created successfully.`);
  }

  await dataSource.destroy();
}

void main();
