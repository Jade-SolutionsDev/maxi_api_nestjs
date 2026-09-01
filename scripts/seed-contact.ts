import { DataSource } from 'typeorm';
import { Client } from '../src/clients/entities/client.entity';
import {
  ContactMessage,
  ContactMessageStatus,
} from '../src/contact/entities/contact-message.entity';
import { Nomenclator } from '../src/nomenclators/entities/nomenclator.entity';

/**
 * Seeds clients with phone numbers plus contact messages in every identity
 * shape (client with phone, anonymous phone-only, email-only, both), so the
 * back-office reply channels (WhatsApp, llamada, email) can be exercised.
 * Idempotent — matched by clerkId / message text, never destructive.
 *
 * Run: pnpm run seed:contact
 */
const DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgres://maxihabana:maxihabana@localhost:5432/maxihabana';

const dataSource = new DataSource({
  type: 'postgres',
  url: DATABASE_URL,
  entities: [Client, ContactMessage, Nomenclator],
  synchronize: false, // tables already exist (managed by migrations); only insert.
});

const CLIENTS = [
  {
    clerkId: 'seed_contact_yamila',
    firstName: 'Yamila',
    lastName: 'Fernández',
    email: 'yamila.fernandez@example.com',
    phone: '+5352345678',
  },
  {
    clerkId: 'seed_contact_reinier',
    firstName: 'Reinier',
    lastName: 'Sosa',
    email: 'reinier.sosa@example.com',
    phone: '+5358765432',
  },
];

async function main() {
  await dataSource.initialize();
  const clients = dataSource.getRepository(Client);
  const messages = dataSource.getRepository(ContactMessage);
  const nomenclators = dataSource.getRepository(Nomenclator);

  const motives = await nomenclators.find({
    where: { category: 'contact-motive' },
  });
  const motiveId = (code: string) => {
    const motive = motives.find((m) => m.code === code);
    if (!motive) throw new Error(`Motive "${code}" not seeded — run the API once so the AddContact migration seeds the motives.`);
    return motive.id;
  };

  const clientIds: Record<string, string> = {};
  for (const data of CLIENTS) {
    let client = await clients.findOne({
      where: { clerkId: data.clerkId },
      withDeleted: true,
    });
    if (!client) {
      client = await clients.save(clients.create({ ...data, isActive: true }));
      console.log(`Client created: ${data.firstName} (${data.phone})`);
    } else {
      console.log(`Client already exists: ${data.firstName}. Skipping.`);
    }
    clientIds[data.clerkId] = client.id;
  }

  const MESSAGES = [
    {
      motiveId: motiveId('productos'),
      clientId: clientIds.seed_contact_yamila,
      name: 'Yamila',
      lastName: 'Fernández',
      email: 'yamila.fernandez@example.com',
      phone: '+5352345678',
      message:
        'El paquete de café llegó abierto y se perdió parte del contenido. Quiero saber si pueden reponerlo.',
    },
    {
      motiveId: motiveId('entregas'),
      clientId: clientIds.seed_contact_reinier,
      name: 'Reinier',
      lastName: 'Sosa',
      email: 'reinier.sosa@example.com',
      phone: '+5358765432',
      message:
        'Mi pedido lleva tres días en «en proceso» y nadie me ha llamado para coordinar la entrega en Playa.',
    },
    {
      motiveId: motiveId('pedidos'),
      clientId: null,
      name: 'Caridad',
      lastName: 'Domínguez',
      email: null,
      phone: '+5351112233',
      message:
        'Escribo por WhatsApp normalmente: quiero cambiar la dirección de un pedido que hice ayer para mi mamá en Holguín.',
    },
    {
      motiveId: motiveId('pagos-y-facturacion'),
      clientId: null,
      name: 'Osmany',
      lastName: 'Peña',
      email: 'osmany.pena@example.com',
      phone: null,
      message:
        'Me cobraron dos veces el mismo pedido con la tarjeta. Necesito el comprobante para reclamar al banco.',
    },
    {
      motiveId: motiveId('sugerencias'),
      clientId: null,
      name: 'Lisandra',
      lastName: 'Aguilar',
      email: 'lisandra.aguilar@example.com',
      phone: '+5354445566',
      message:
        'Sería bueno poder filtrar los combos por municipio antes de armar el carrito. Se los sugiero con cariño.',
    },
  ];

  for (const data of MESSAGES) {
    const existing = await messages.findOne({
      where: { message: data.message },
      withDeleted: true,
    });
    if (existing) {
      console.log(`Message from ${data.name} already exists. Skipping.`);
      continue;
    }
    await messages.save(
      messages.create({ ...data, status: ContactMessageStatus.NUEVO }),
    );
    console.log(`Message created: ${data.name} (${data.phone ?? 'sin teléfono'})`);
  }

  await dataSource.destroy();
  console.log('Done.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
