import * as readline from 'readline';
import { DataSource } from 'typeorm';
import { User, UserType } from '../src/users/entities/user.entity';

const DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgres://maxihabana:maxihabana@localhost:5432/maxihabana';

const dataSource = new DataSource({
  type: 'postgres',
  url: DATABASE_URL,
  entities: [User],
  synchronize: true,
});

function ask(question: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function main() {
  const clerkId = await ask('Superadmin clerkId: ');
  const email = await ask('Superadmin email: ');

  if (!clerkId || !email) {
    console.error('clerkId and email are required.');
    process.exit(1);
  }

  await dataSource.initialize();
  const repository = dataSource.getRepository(User);

  const existing = await repository.findOne({
    where: { clerkId },
    withDeleted: true,
  });

  if (existing) {
    console.warn(`A user with clerkId "${clerkId}" already exists. Skipping.`);
  } else {
    const user = repository.create({
      clerkId,
      firstName: 'Super',
      lastName: 'Admin',
      email: email.toLowerCase(),
      userType: UserType.ADMIN,
      isActive: true,
    });

    await repository.save(user);
    console.log(`Superadmin "${email}" created successfully.`);
  }

  await dataSource.destroy();
}

void main();
