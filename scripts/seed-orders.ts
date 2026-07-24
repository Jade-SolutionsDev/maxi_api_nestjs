import { NestFactory } from '@nestjs/core';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { CartService } from '../src/cart/cart.service';
import { Client } from '../src/clients/entities/client.entity';
import { OrdersService } from '../src/orders/orders.service';
import {
  OrderStatus,
  PaymentStatus,
} from '../src/orders/entities/order.entity';
import { ProductsService } from '../src/products/products.service';
import { Role, User } from '../src/users/entities/user.entity';

// Demo orders for the admin UI. Runs the REAL flows (cart -> checkout ->
// status transitions), so stock reservations and physical quantities stay
// consistent — confirmed/delivered orders genuinely decrement stock.
// Prerequisites: products with available stock (seed:products + inventory)
// and ideally some clients (falls back to creating demo ones).

interface Scenario {
  statuses: OrderStatus[];
  payment?: PaymentStatus;
  notes: string | null;
  address: Record<string, unknown> | null;
}

const SCENARIOS: Scenario[] = [
  {
    statuses: [],
    payment: undefined, // stays pending/pending — shows the client-cancellable state
    notes: 'Tocar el timbre dos veces, por favor.',
    address: { calle: 'Calle 23 #456', entre: 'L y M', municipio: 'Vedado' },
  },
  {
    statuses: [OrderStatus.CONFIRMED],
    payment: PaymentStatus.PAID,
    notes: null,
    address: { calle: 'San Lázaro #1201', municipio: 'Centro Habana' },
  },
  {
    statuses: [OrderStatus.CONFIRMED, OrderStatus.PROCESSING],
    payment: PaymentStatus.PAID,
    notes: 'Entregar en horario de la mañana.',
    address: { calle: 'Ave 41 #2203', municipio: 'Playa' },
  },
  {
    statuses: [
      OrderStatus.CONFIRMED,
      OrderStatus.PROCESSING,
      OrderStatus.SHIPPED,
    ],
    payment: PaymentStatus.PAID,
    notes: null,
    address: { calle: 'Calzada de Güines #77', municipio: 'San Miguel' },
  },
  {
    statuses: [
      OrderStatus.CONFIRMED,
      OrderStatus.PROCESSING,
      OrderStatus.SHIPPED,
      OrderStatus.DELIVERED,
    ],
    payment: PaymentStatus.PAID,
    notes: 'Dejar con el vecino si no estoy.',
    address: { calle: 'Obispo #305', municipio: 'Habana Vieja' },
  },
  {
    statuses: [OrderStatus.CANCELLED], // cancelled while pending -> hold released
    payment: PaymentStatus.FAILED,
    notes: 'Pedido de prueba cancelado.',
    address: null,
  },
];

const DEMO_CLIENTS = [
  { clerkId: 'seed_client_ana', firstName: 'Ana', lastName: 'Pérez', email: 'ana.perez@example.com' },
  { clerkId: 'seed_client_luis', firstName: 'Luis', lastName: 'García', email: 'luis.garcia@example.com' },
  { clerkId: 'seed_client_marta', firstName: 'Marta', lastName: 'Díaz', email: 'marta.diaz@example.com' },
];

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });
  const dataSource = app.get(DataSource);
  const cartService = app.get(CartService);
  const ordersService = app.get(OrdersService);
  const productsService = app.get(ProductsService);
  // Status transitions only read the actor's role.
  const admin = { role: Role.ADMIN } as User;

  // Clients: reuse existing active ones, top up with demo clients if few.
  const clientRepo = dataSource.getRepository(Client);
  const clients = await clientRepo.find({ take: 3 });
  for (const demo of DEMO_CLIENTS.slice(clients.length)) {
    clients.push(await clientRepo.save(clientRepo.create(demo)));
    console.log(`Created demo client ${demo.email}`);
  }

  // Products that actually have sellable stock right now.
  const storefront = await productsService.findStorefront({});
  const inStock = storefront.filter((r) => r.stock >= 2);
  if (inStock.length === 0) {
    console.error(
      'No products with available stock. Seed products and add inventory first.',
    );
    await app.close();
    process.exit(1);
  }

  for (const [index, scenario] of SCENARIOS.entries()) {
    const client = clients[index % clients.length];

    // 1-3 lines per order, rotating through the in-stock catalog.
    const lines = inStock.slice(index % inStock.length).slice(0, 1 + (index % 3));
    await cartService.clear(client.id);
    for (const line of lines) {
      await cartService.addItem(
        client.id,
        line.product.id,
        Math.min(2, line.stock),
      );
    }

    const order = await ordersService.checkout(client, {
      deliveryAddress: scenario.address ?? undefined,
      customerNotes: scenario.notes ?? undefined,
    });

    for (const status of scenario.statuses) {
      await ordersService.updateStatus(admin, order.id, status);
    }
    if (scenario.payment) {
      await ordersService.updatePaymentStatus(order.id, scenario.payment);
    }

    const finalStatus = scenario.statuses.at(-1) ?? OrderStatus.PENDING;
    console.log(
      `${order.orderNumber}: ${lines.length} line(s), ${finalStatus}/${scenario.payment ?? PaymentStatus.PENDING} for ${client.email}`,
    );
  }

  console.log('Done. Open /orders in the admin to browse them.');
  await app.close();
}

void main();
