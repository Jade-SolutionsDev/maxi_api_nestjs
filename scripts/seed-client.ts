import * as readline from 'readline';
import { DataSource } from 'typeorm';
import { Client } from '../src/clients/entities/client.entity';

const DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgres://maxihabana:maxihabana@localhost:5432/maxihabana';

const dataSource = new DataSource({
  type: 'postgres',
  url: DATABASE_URL,
  entities: [Client],
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
  const clerkId = await ask('Client clerkId: ');
  const email = await ask('Client email: ');

  if (!clerkId || !email) {
    console.error('clerkId and email are required.');
    process.exit(1);
  }

  await dataSource.initialize();
  const repository = dataSource.getRepository(Client);

  const existing = await repository.findOne({
    where: { clerkId },
    withDeleted: true,
  });

  if (existing) {
    console.warn(
      `A client with clerkId "${clerkId}" already exists. Skipping.`,
    );
  } else {
    const client = repository.create({
      clerkId,
      firstName: 'Client',
      lastName: 'User',
      email: email.toLowerCase(),
      isActive: true,
    });

    await repository.save(client);
    console.log(`Client "${email}" created successfully.`);
  }

  await dataSource.destroy();
}

void main();
