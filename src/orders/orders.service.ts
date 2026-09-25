import { randomBytes } from 'node:crypto';
import { sinTildes } from '../common/search/accent-insensitive';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  DataSource,
  EntityManager,
  IsNull,
  Repository,
  SelectQueryBuilder,
} from 'typeorm';
import { CartService } from '../cart/cart.service';
import { CartItem } from '../cart/entities/cart-item.entity';
import { Client } from '../clients/entities/client.entity';
import {
  buildPaginatedResponse,
  getPaginationParams,
  PaginatedResponse,
} from '../common/dto/pagination.dto';
import { InventoryService } from '../inventory/inventory.service';
import {
  isSystemAdmin,
  PermissionsService,
} from '../permissions/permissions.service';
import { ProductsService } from '../products/products.service';
import { OrderEventKind } from '../order-events/entities/order-event.entity';
import { OrderEventsService } from '../order-events/order-events.service';
import { OrderMailerService } from '../mail/order-mailer.service';
import { Role, User } from '../users/entities/user.entity';
import {
  AdminOrdersQueryDto,
  SIN_METODO_DE_PAGO,
} from './dto/admin-orders-query.dto';
import { CheckoutDto } from './dto/checkout.dto';
import { CorrectOrderDto } from './dto/correct-order.dto';
import { CreateOrderForClientDto } from './dto/create-order-for-client.dto';
import { OrderResponseDto } from './dto/order-response.dto';
import { PickedUpByDto } from './dto/update-order-status.dto';
import {
  ESTADO_PARA_EL_CLIENTE,
  estaPagado,
  OrderTrackingResponseDto,
} from './dto/order-tracking.dto';
import { UpdateOrderItemsDto } from './dto/update-order-items.dto';
import { OrderItem } from './entities/order-item.entity';
import {
  CancellationReason,
  FulfillmentType,
  Order,
  OrderStatus,
  PaymentStatus,
} from './entities/order.entity';
import { ClientAddressesService } from '../client-addresses/client-addresses.service';
import { ClientAddress } from '../client-addresses/entities/client-address.entity';
import {
  FulfillmentChoice,
  FulfillmentService,
} from '../fulfillment/fulfillment.service';
import { GeographyService } from '../geography/geography.service';
import {
  PaymentMethodsService,
  ResolvedPaymentMethod,
} from '../payments/payment-methods.service';
import { PaymentsService } from '../payments/payments.service';
import { deshacerCobro, sellarCobro } from './payment-sealing';

/**
 * Qué hace el stock en cada estado: retenido (reserva viva), comprometido
 * (ya descontado del almacén) o liberado. La corrección de superadmin mueve
 * el stock entre fases, no entre estados.
 */
type StockPhase = 'held' | 'committed' | 'released';
const stockPhase = (status: OrderStatus): StockPhase =>
  status === OrderStatus.PENDING
    ? 'held'
    : status === OrderStatus.CANCELLED
      ? 'released'
      : 'committed';

const TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  [OrderStatus.PENDING]: [OrderStatus.CONFIRMED, OrderStatus.CANCELLED],
  [OrderStatus.CONFIRMED]: [OrderStatus.PROCESSING, OrderStatus.CANCELLED],
  [OrderStatus.PROCESSING]: [OrderStatus.SHIPPED, OrderStatus.CANCELLED],
  [OrderStatus.SHIPPED]: [OrderStatus.DELIVERED, OrderStatus.CANCELLED],
  [OrderStatus.DELIVERED]: [],
  [OrderStatus.CANCELLED]: [],
};

// Legal manual payment-status moves: settle or fail a pending payment, retry
// a failed one, refund a paid one. Webhooks bypass this (gateway is truth).
const PAYMENT_TRANSITIONS: Record<PaymentStatus, PaymentStatus[]> = {
  [PaymentStatus.PENDING]: [PaymentStatus.PAID, PaymentStatus.FAILED],
  [PaymentStatus.FAILED]: [PaymentStatus.PAID, PaymentStatus.PENDING],
  [PaymentStatus.PAID]: [PaymentStatus.REFUNDED],
  [PaymentStatus.REFUNDED]: [],
};

// Fulfillment steps non-admin staff may drive; confirm/cancel (which move
// stock and commit the sale) and payment stay with ADMIN+.
const STAFF_TARGETS = [
  OrderStatus.PROCESSING,
  OrderStatus.SHIPPED,
  OrderStatus.DELIVERED,
];

// The fulfillment chain in order, for direct jumps (cancelled sits outside).
const FORWARD_CHAIN = [
  OrderStatus.PENDING,
  OrderStatus.CONFIRMED,
  OrderStatus.PROCESSING,
  OrderStatus.SHIPPED,
  OrderStatus.DELIVERED,
];

/** What the order keeps of an address, independent of the address book. */
const snapshotAddress = (
  address: ClientAddress,
  place: { municipality: string; province: string } | null,
): Record<string, unknown> => ({
  label: address.label ?? null,
  street: address.street,
  betweenStreets: address.betweenStreets ?? null,
  reference: address.reference ?? null,
  municipalityId: address.municipalityId,
  // Names too: an id tells a customer reading their own order nothing, and the
  // catalog entry may be renamed or removed long after the order shipped.
  municipalityName: place?.municipality ?? null,
  provinceName: place?.province ?? null,
  contactPhone: address.contactPhone ?? null,
});

/**
 * Quién recibe el pedido. La dirección lo lleva cuando hay dirección; en una
 * recogida no la hay, y entonces viene suelto en `contact`.
 */
const snapshotContact = (
  source: {
    recipientName?: string | null;
    idCard?: string | null;
    contactPhone?: string | null;
  } | null,
): Record<string, unknown> | null => {
  if (!source) return null;
  const recipientName = source.recipientName?.trim() || null;
  const idCard = source.idCard?.trim() || null;
  const contactPhone = source.contactPhone?.trim() || null;
  // Un objeto con los tres campos en null no dice nada y ensucia el jsonb.
  if (!recipientName && !idCard && !contactPhone) return null;
  return { recipientName, idCard, contactPhone };
};

// Un valor que no sea texto (u otro `Record` anidado, un número, …) se trata
// como ausente, igual que si el campo no existiera: `deliveryAddress` es de
// forma libre y no se valida su estructura (ver create-order-for-client.dto).
const comoTextoOAusente = (value: unknown): string | null | undefined =>
  typeof value === 'string' || value === null ? value : undefined;

/**
 * Lee el destinatario de una dirección de entrega de forma libre
 * (`Record<string, unknown>`), con el mismo contrato que espera
 * `snapshotContact` — sin ensanchar su firma ni recurrir a `any`.
 *
 * Existe para que `crearParaCliente` haga lo mismo que `checkout()`: si no
 * llega `contact`, el destinatario sale de la dirección. Sin esto, el panel
 * no tiene de dónde sacarlo y se ve obligado a exigir `contact` —con carné
 * cubano obligatorio— para una entrega a domicilio que la tienda resuelve
 * sin pedir carné nunca (`CreateClientAddressDto.idCard` es opcional).
 */
const contactoDesdeDireccion = (
  address: Record<string, unknown> | null | undefined,
): {
  recipientName?: string | null;
  idCard?: string | null;
  contactPhone?: string | null;
} | null => {
  if (!address) return null;
  return {
    recipientName: comoTextoOAusente(address.recipientName),
    idCard: comoTextoOAusente(address.idCard),
    contactPhone: comoTextoOAusente(address.contactPhone),
  };
};

/** Una línea ya valorada: el núcleo no vuelve a mirar el catálogo. */
interface LineaResuelta {
  productId: string;
  name: string;
  quantity: number;
  unitPrice: number;
}

interface CrearPedidoParams {
  clientId: string;
  lineas: LineaResuelta[];
  fulfillment: FulfillmentChoice;
  deliveryMunicipalityId?: string;
  deliveryAddress: Record<string, unknown> | null;
  contactSnapshot: Record<string, unknown> | null;
  customerNotes: string | null;
  allowedLocationIds?: string[];
  /** Quién crea el pedido: el propio cliente, o un empleado por él. */
  actor: { clientId: string } | { userId: string };
  /** Código del método de pago, solo para el `meta` del evento. */
  paymentMethodCode: string | null;
  /** Lo que cada llamador quiera dejar en el `meta` del evento de creación. */
  metaExtra?: Record<string, unknown>;
  /**
   * Trabajo extra que tiene que caber en la MISMA transacción. La tienda vacía
   * aquí el carrito; el panel sella aquí el cobro. El núcleo no sabe de
   * carritos ni de cobros.
   */
  alFinalizar?: (manager: EntityManager, order: Order) => Promise<void>;
}

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    @InjectRepository(Order)
    private readonly orderRepository: Repository<Order>,
    @InjectRepository(Client)
    private readonly clientRepository: Repository<Client>,
    private readonly cartService: CartService,
    private readonly inventoryService: InventoryService,
    private readonly paymentsService: PaymentsService,
    private readonly paymentMethodsService: PaymentMethodsService,
    private readonly fulfillmentService: FulfillmentService,
    private readonly productsService: ProductsService,
    private readonly clientAddressesService: ClientAddressesService,
    private readonly geographyService: GeographyService,
    private readonly permissionsService: PermissionsService,
    private readonly orderEvents: OrderEventsService,
    private readonly orderMailer: OrderMailerService,
    private readonly dataSource: DataSource,
  ) {}

  // List rows carry the method name and the transfer flag (not the whole
  // attempt/detail): two batched queries for the page, never one per row.
  private async withPaymentMethods(
    orders: Order[],
  ): Promise<OrderResponseDto[]> {
    const orderIds = orders.map((order) => order.id);
    const [methods, transferIds] = await Promise.all([
      this.paymentsService.latestMethodsFor(orderIds),
      this.needsTransferIds(orderIds),
    ]);
    return orders.map((order) => {
      const dto = OrderResponseDto.fromEntity(order);
      dto.paymentMethod = methods.get(order.id);
      dto.needsTransfer = transferIds.has(order.id);
      return dto;
    });
  }

  // Same predicate as the list's needsTransfer filter: pickup orders still
  // holding RESERVED stock away from their counter.
  private async needsTransferIds(orderIds: string[]): Promise<Set<string>> {
    if (orderIds.length === 0) return new Set();
    const rows: { order_id: string }[] =
      await this.orderRepository.manager.query(
        `SELECT DISTINCT r.order_id
           FROM inventory_reservations r
           JOIN orders o ON o.id = r.order_id
          WHERE r.order_id = ANY($1)
            AND o.fulfillment_type = 'pickup'
            AND r.status = 'reserved'
            AND r.location_id <> o.pickup_location_id`,
        [orderIds],
      );
    return new Set(rows.map((row) => row.order_id));
  }

  // ---------------- Storefront ----------------

  // Turns the client's cart into a pending order: snapshots names/prices from
  // the cart response (already server-computed), reserves stock per line, and
  // clears the cart — all in one transaction. Payment initiation runs AFTER
  // commit: an outbound gateway call must not hold the inventory row locks,
  // and a gateway failure must not lose the order.
  async checkout(client: Client, dto: CheckoutDto): Promise<OrderResponseDto> {
    // Where the order is going, and how. Both are settled before anything is
    // written: a choice the shop cannot honour must 400, not become an order
    // nobody can fill.
    const address = await this.resolveAddress(client, dto);
    const deliveryMunicipalityId =
      address?.municipalityId ??
      dto.deliveryMunicipalityId ??
      client.defaultMunicipalityId ??
      undefined;

    const place = address ? await this.resolvePlace(address) : null;

    const fulfillment = await this.fulfillmentService.resolveChoice({
      fulfillmentType: dto.fulfillmentType,
      deliveryOptionId: dto.deliveryOptionId,
      pickupAddressId: dto.pickupAddressId,
      municipalityId: deliveryMunicipalityId,
    });

    // Availability is judged across every storage covering the customer's
    // municipality — the same stock the catalog showed. A pickup order may
    // draw from sibling storages (the admin gets a transfer alert); pinning it
    // to the counter's own shelf would reject carts the shop can fulfil.
    // En recogida no hay dirección ninguna, así que estos datos solo pueden
    // llegar sueltos. Sin ellos nadie sabe a quién entregar en el mostrador.
    if (fulfillment.type === FulfillmentType.PICKUP && !dto.contact) {
      throw new BadRequestException(
        'Faltan los datos de quien recoge el pedido',
      );
    }

    const cart = await this.cartService.getCart(client.id, {
      municipalityId: deliveryMunicipalityId,
    });
    if (cart.items.length === 0) {
      throw new BadRequestException('Cart is empty');
    }
    const unavailable = cart.items.filter((i) => !i.isAvailable);
    if (unavailable.length > 0) {
      throw new ConflictException({
        message: 'Some cart items are no longer available',
        details: unavailable.map((i) => ({
          field: i.productId,
          message: `"${i.name}": only ${i.available} available`,
          available: i.available,
        })),
      });
    }

    // Resolved before anything is written: an unknown or disabled method must
    // 400 rather than silently produce an order nobody can pay. DB-only, no
    // gateway call.
    const resolvedPayment = await this.paymentMethodsService.resolve(
      dto.paymentMethod,
    );

    // Reservations stay within the storages covering the municipality; without
    // a municipality (pickup-only client with no location) any active storage
    // may hold the stock, as before.
    const allowedLocationIds = await this.resolveAllowedLocationIds(
      deliveryMunicipalityId,
      fulfillment,
    );

    const orderId = await this.crearPedido({
      clientId: client.id,
      lineas: cart.items.map((line) => ({
        productId: line.productId,
        name: line.name,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
      })),
      fulfillment,
      deliveryMunicipalityId,
      deliveryAddress: address
        ? snapshotAddress(address, place)
        : (dto.deliveryAddress ?? null),
      contactSnapshot: snapshotContact(dto.contact ?? address),
      customerNotes: dto.customerNotes ?? null,
      allowedLocationIds,
      actor: { clientId: client.id },
      paymentMethodCode: dto.paymentMethod ?? null,
      // El carrito se vacía DENTRO de la transacción, como hasta ahora: si la
      // reserva falla, el cliente conserva su carrito.
      alFinalizar: async (manager) => {
        await manager.getRepository(CartItem).delete({ clientId: client.id });
      },
    });

    // Deliberately NOT awaited. Creating the attempt is a live call to the
    // gateway — seconds, sometimes many — and the order is already committed
    // and visible by now, so making the customer watch a spinner for it only
    // risks them abandoning a checkout that already succeeded. The order page
    // polls for the attempt and can start one itself if this fails.
    if (dto.saveAddress && dto.address && !dto.addressId) {
      // After the commit, and never fatal: the order is placed either way.
      try {
        await this.clientAddressesService.create(client.id, dto.address);
      } catch (err) {
        this.logger.error(
          `Could not save the address of order ${orderId} to the address book`,
          err instanceof Error ? err.stack : String(err),
        );
      }
    }

    void this.initiatePayment(orderId, resolvedPayment);

    // Tampoco se espera: el pedido ya está guardado y el correo no puede
    // retrasar la respuesta ni tumbarla si el proveedor falla. Sale antes de
    // que el cliente elija cómo pagar, que es cuando más falta le hace tener
    // el número del pedido por escrito.
    void this.orderMailer.orderReceived(orderId).catch((err) => {
      // `dispatch` ya se traga sus errores, pero el `.catch()` es la garantía
      // de que ningún fallo futuro ahí dentro se convierta en un rechazo sin
      // atender: eso tumba el proceso de Node, y tumbarlo justo después de
      // cobrar es la peor forma de perder una venta.
      this.logger.error(
        `No se pudo avisar por correo del pedido ${orderId}`,
        err instanceof Error ? err.stack : String(err),
      );
    });

    return this.findOneForClient(client.id, orderId);
  }

  /**
   * Un pedido que hace un empleado en nombre de un cliente: quien compra por
   * WhatsApp o por teléfono y no pasa por la tienda.
   *
   * Nace igual que uno de la tienda —mismo núcleo, mismas reservas, mismo
   * plazo de caducidad— con dos diferencias: el carrito del cliente no se
   * toca, y no se abre ningún intento de pago, porque un intento es una sesión
   * de cobro a nombre del comprador y un empleado no puede abrirla por él.
   */
  async crearParaCliente(
    user: User,
    dto: CreateOrderForClientDto,
  ): Promise<OrderResponseDto> {
    // Antes de resolver o escribir nada: un 403 no puede dejar rastro. Se
    // captura `cobro` aparte porque TypeScript no arrastra el estrechamiento
    // de `dto.cobro` dentro del closure de `alFinalizar`, más abajo.
    const cobro = dto.cobro;
    if (cobro) {
      const puedeCobrar = await this.permissionsService.hasPermission(
        user.id,
        user.role,
        'orders',
        'update-payment-status',
      );
      if (!puedeCobrar) {
        throw new ForbiddenException(
          'No puedes marcar un pedido como cobrado; créalo pendiente',
        );
      }
    }

    const client = await this.clientRepository.findOne({
      where: { id: dto.clientId },
    });
    if (!client) {
      throw new NotFoundException(`No existe el cliente "${dto.clientId}"`);
    }
    // Mismo criterio que auth/client-auth.service.ts: dado de baja o gateado,
    // el panel no puede abrirle un pedido a alguien a quien la tienda ya le
    // cerró la puerta.
    if (!client.isActive) {
      throw new ConflictException(
        `El cliente "${client.id}" está desactivado; no se le puede crear un pedido`,
      );
    }

    const productIds = dto.items.map((line) => line.productId);
    if (new Set(productIds).size !== productIds.length) {
      throw new BadRequestException(
        'Un producto no puede aparecer dos veces; súmalo en una sola línea',
      );
    }

    // Se cargan una sola vez: la misma ficha sirve para juzgar si están a la
    // venta (más abajo) y, después, para el nombre y el precio de
    // resolveLines(). `findOne` ya 404 si algún id no existe.
    const productos = new Map(
      await Promise.all(
        productIds.map(
          async (id) => [id, await this.productsService.findOne(id)] as const,
        ),
      ),
    );

    const deliveryMunicipalityId =
      dto.deliveryMunicipalityId ?? client.defaultMunicipalityId ?? undefined;

    // La dirección es de forma libre y no se valida su estructura (ver el
    // DTO), pero si trae un municipio que contradice el efectivo, algo está
    // mal armado: sin este corte se entregaría con la tarifa y la cobertura
    // de un municipio distinto al que dice la dirección, en silencio.
    const municipioEnDireccion =
      dto.deliveryAddress &&
      typeof dto.deliveryAddress.municipalityId === 'string'
        ? dto.deliveryAddress.municipalityId
        : undefined;
    if (
      municipioEnDireccion &&
      municipioEnDireccion !== deliveryMunicipalityId
    ) {
      throw new BadRequestException(
        `La dirección dice el municipio "${municipioEnDireccion}", pero el pedido se está armando para "${deliveryMunicipalityId}"`,
      );
    }

    const fulfillment = await this.fulfillmentService.resolveChoice({
      fulfillmentType: dto.fulfillmentType,
      deliveryOptionId: dto.deliveryOptionId,
      pickupAddressId: dto.pickupAddressId,
      municipalityId: deliveryMunicipalityId,
    });

    if (fulfillment.type === FulfillmentType.PICKUP && !dto.contact) {
      throw new BadRequestException(
        'Faltan los datos de quien recoge el pedido',
      );
    }

    // La disponibilidad se mira ANTES de abrir la transacción para poder decir
    // qué falta y cuánto hay, igual que el carrito de la tienda. La red final
    // sigue siendo `reserve`, que la re-comprueba bajo bloqueo.
    const disponible = await this.productsService.availableForArea(productIds, {
      municipalityId: deliveryMunicipalityId,
    });

    // "A la venta" y "con stock" se juzgan JUNTOS, igual que el carrito
    // (CartItemResponseDto.fromEntity: isActive && !deletedAt && stock): un
    // único 409 con detalle por línea, para que no gane la condición que se
    // compruebe primero. `resolveLines()`, más abajo, ya no tendrá nada que
    // rechazar por su cuenta.
    const faltan = dto.items
      .map((item) => {
        const product = productos.get(item.productId)!;
        const available = disponible.get(item.productId) ?? 0;
        const vendible =
          product.isActive && !product.deletedAt && available >= item.quantity;
        return { item, product, available, vendible };
      })
      .filter((linea) => !linea.vendible);

    if (faltan.length > 0) {
      throw new ConflictException({
        message: 'Some cart items are no longer available',
        details: faltan.map(({ item, product, available }) => ({
          field: item.productId,
          message: `"${product.name}": only ${available} available`,
          available,
        })),
      });
    }

    // Mismo valorador que usa la corrección de líneas: precio del catálogo con
    // su descuento, o el que escriba quien atiende si pactó otro por teléfono.
    // El mapa vacío hace que resolveLines() trate todas las líneas como
    // nuevas, que es justo lo que hace falta aquí: no hay pedido previo del
    // que heredar nombre o precio.
    const lineas = await this.resolveLines(dto.items, new Map());

    // Resuelto para que un método de pago inexistente dé 400 ANTES de
    // escribir nada. No se usa después a propósito: este alta no abre ningún
    // intento de cobro (ver el porqué en el comentario del método).
    const resolvedPayment = dto.paymentMethod
      ? await this.paymentMethodsService.resolve(dto.paymentMethod)
      : null;
    void resolvedPayment;

    // El código del cobro pasa por el mismo catálogo que dto.paymentMethod:
    // sin esto, un código inventado entraría tal cual al historial.
    if (cobro) {
      await this.paymentMethodsService.resolve(cobro.paymentMethod);
    }

    const allowedLocationIds = await this.resolveAllowedLocationIds(
      deliveryMunicipalityId,
      fulfillment,
    );

    // Rastro de quién pactó qué: un precio a mano es dinero tecleado por una
    // persona, y sin esto el pedido no dice quién lo decidió ni cuál línea.
    const lineasConPrecioPactado = dto.items
      .filter((item) => item.unitPrice !== undefined && item.unitPrice !== null)
      .map((item) => item.productId);

    const orderId = await this.crearPedido({
      clientId: client.id,
      lineas,
      fulfillment,
      deliveryMunicipalityId,
      deliveryAddress: dto.deliveryAddress ?? null,
      // Mismo `trim` y mismo criterio de «tres nulos = nada» que checkout, y
      // el mismo fallback a la dirección cuando no llega `contact`: en
      // recogida sigue siendo obligatorio (comprobado más arriba, no hay
      // dirección de la que sacarlo), pero en entrega el panel no puede
      // exigir más datos que la tienda.
      contactSnapshot: snapshotContact(
        dto.contact ?? contactoDesdeDireccion(dto.deliveryAddress),
      ),
      customerNotes: dto.customerNotes ?? null,
      allowedLocationIds,
      actor: { userId: user.id },
      // Si no viene un método de pago propio (no se abre ningún intento), el
      // del cobro ya hecho manda: sin esto, el evento de creación decía
      // `null` mientras el de cobro, un renglón más abajo, decía el método
      // real — dos eventos de la misma alta contando cosas distintas.
      paymentMethodCode: dto.paymentMethod ?? cobro?.paymentMethod ?? null,
      metaExtra: {
        canal: 'back-office',
        ...(lineasConPrecioPactado.length > 0
          ? { lineasConPrecioPactado }
          : {}),
      },
      // Dentro de la MISMA transacción que crea el pedido, a propósito: entre
      // crear y cobrar habría un hueco con el pedido pendiente, y el barrido
      // de caducidad puede pasar por ahí y cancelar una venta ya cobrada.
      alFinalizar: cobro
        ? async (manager, order) => {
            order.paymentStatus = PaymentStatus.PAID;
            order.paymentRef = cobro.reference ?? null;
            sellarCobro(order);
            await manager.getRepository(Order).save(order);
            await this.orderEvents.record(manager, {
              orderId: order.id,
              kind: OrderEventKind.PAYMENT_STATUS_CHANGED,
              actor: { userId: user.id },
              field: 'paymentStatus',
              previousValue: PaymentStatus.PENDING,
              nextValue: PaymentStatus.PAID,
              meta: {
                canal: 'back-office',
                paymentMethod: cobro.paymentMethod,
                reference: cobro.reference ?? null,
              },
            });
          }
        : undefined,
    });

    const aviso = cobro
      ? this.orderMailer.paymentReceived(orderId)
      : this.orderMailer.orderReceived(orderId);
    void aviso.catch((err) => {
      this.logger.error(
        `No se pudo avisar por correo del pedido ${orderId}`,
        err instanceof Error ? err.stack : String(err),
      );
    });

    return this.findOneAdmin(orderId);
  }

  /**
   * Los almacenes donde puede vivir la reserva: los que cubren el municipio
   * de entrega, más el propio mostrador de recogida si el catálogo no lo
   * contaba (una recogida puede salir de un local sin cobertura de reparto).
   * Compartido por `checkout()` y `crearParaCliente()` — es el único cálculo
   * de zona que existe, para que las dos vías no puedan divergir.
   */
  private async resolveAllowedLocationIds(
    deliveryMunicipalityId: string | undefined,
    fulfillment: FulfillmentChoice,
  ): Promise<string[] | undefined> {
    const coveringIds = deliveryMunicipalityId
      ? await this.productsService.coveringLocationIds({
          municipalityId: deliveryMunicipalityId,
        })
      : undefined;
    return coveringIds && fulfillment.pickupLocationId
      ? [...new Set([...coveringIds, fulfillment.pickupLocationId])]
      : coveringIds;
  }

  /**
   * Crea el pedido y aparta su stock, en una sola transacción.
   *
   * Es el único sitio donde nace un pedido. Recibe las líneas **ya valoradas**
   * y no sabe de dónde salieron: del carrito del cliente en la tienda, o de lo
   * que escribió un empleado en el panel. Así las dos vías no pueden acabar
   * contando el stock o los totales de maneras distintas.
   *
   * No toca carritos y no manda correos: eso lo decide cada llamador.
   */
  private async crearPedido(params: CrearPedidoParams): Promise<string> {
    return this.dataSource.transaction(async (manager) => {
      // En céntimos y dividiendo al final: la misma cuenta que hace cada
      // lineTotal más abajo, para que la cabecera nunca pueda descuadrar de
      // sus líneas por redondeo. El carrito ya sumaba lo mismo
      // (cart-response.dto.ts) pero aquí el núcleo lo impone, no lo hereda.
      const subtotal =
        params.lineas.reduce(
          (c, l) => c + Math.round(l.unitPrice * l.quantity * 100),
          0,
        ) / 100;
      const total = (subtotal + Number(params.fulfillment.fee)).toFixed(2);

      const orderRepo = manager.getRepository(Order);
      const order = await orderRepo.save(
        orderRepo.create({
          clientId: params.clientId,
          status: OrderStatus.PENDING,
          paymentStatus: PaymentStatus.PENDING,
          subtotal: subtotal.toFixed(2),
          deliveryFee: params.fulfillment.fee,
          total,
          fulfillmentType: params.fulfillment.type,
          deliveryOptionId: params.fulfillment.deliveryOptionId,
          deliveryOptionLabel: params.fulfillment.deliveryOptionLabel,
          pickupLocationId: params.fulfillment.pickupLocationId,
          pickupAddressId: params.fulfillment.pickupAddressId,
          pickupAddressSnapshot: params.fulfillment.pickupAddressSnapshot,
          // El plazo se congela aquí, como la etiqueta y la tarifa: cambiar
          // la opción de entrega mañana no reescribe lo prometido hoy.
          promiseDays: params.fulfillment.promiseDays,
          deliveryMunicipalityId: params.deliveryMunicipalityId ?? null,
          // A snapshot: the saved address may be edited or deleted later, the
          // order must still say where it was going.
          deliveryAddress: params.deliveryAddress,
          // `contact` manda sobre la dirección: es lo que el cliente acaba de
          // escribir en este checkout, mientras que la dirección guardada
          // puede llevar meses ahí con otro destinatario.
          contactSnapshot: params.contactSnapshot,
          customerNotes: params.customerNotes,
        }),
      );
      order.orderNumber = `ORD-${new Date().getFullYear()}${String(order.seq).padStart(4, '0')}`;
      // El enlace de seguimiento se reparte por fuera (WhatsApp, correo), así
      // que su identificador no puede deducirse del número de pedido, que es
      // correlativo. 32 bytes aleatorios, y no cambia en toda la vida del pedido.
      order.trackingId = randomBytes(32).toString('hex');
      await orderRepo.save(order);

      const itemRepo = manager.getRepository(OrderItem);
      for (const line of params.lineas) {
        // reserve() re-checks availability under lock — a concurrent checkout
        // of the same stock loses with the same 409 shape as the cart.
        await this.inventoryService.reserve(
          manager,
          order.id,
          line.productId,
          line.quantity,
          {
            allowedLocationIds: params.allowedLocationIds,
            // Pickup drains the customer's counter first; overflow lands at
            // sibling covering storages and flags the order for a transfer.
            preferredLocationId:
              params.fulfillment.pickupLocationId ?? undefined,
          },
        );
        const lineTotal = (
          Math.round(line.unitPrice * line.quantity * 100) / 100
        ).toFixed(2);
        await itemRepo.save(
          itemRepo.create({
            orderId: order.id,
            productId: line.productId,
            productNameSnapshot: line.name,
            unitPrice: line.unitPrice.toFixed(2),
            quantity: line.quantity,
            lineTotal,
          }),
        );
      }

      await this.orderEvents.record(manager, {
        orderId: order.id,
        kind: OrderEventKind.CREATED,
        actor: params.actor,
        field: 'status',
        nextValue: OrderStatus.PENDING,
        meta: {
          ...params.metaExtra,
          total,
          fulfillmentType: params.fulfillment.type,
          paymentMethod: params.paymentMethodCode,
        },
      });

      await params.alFinalizar?.(manager, order);
      return order.id;
    });
  }

  /**
   * The address this order ships to: a saved one (ownership-checked), or one
   * typed at checkout — persisted to the customer's book only if they asked.
   * Pickup orders have none.
   */
  private async resolveAddress(
    client: Client,
    dto: CheckoutDto,
  ): Promise<ClientAddress | null> {
    if (dto.fulfillmentType === FulfillmentType.PICKUP) return null;

    if (dto.addressId) {
      return this.clientAddressesService.findOneForClient(
        client.id,
        dto.addressId,
      );
    }
    if (!dto.address) return null;

    // Detached: the order snapshots it. Saving to the address book happens
    // only once the order exists — a checkout that fails must not leave the
    // customer with a new address (and a retry with a duplicate of it).
    return {
      ...dto.address,
      clientId: client.id,
      municipalityId: dto.address.municipalityId,
    } as ClientAddress;
  }

  // Human-readable place for the order's address snapshot.
  private async resolvePlace(
    address: ClientAddress,
  ): Promise<{ municipality: string; province: string } | null> {
    try {
      const municipality = await this.geographyService.getMunicipalityOrThrow(
        address.municipalityId,
      );
      const province = await this.geographyService.getProvinceOrThrow(
        municipality.provinceId,
      );
      return { municipality: municipality.name, province: province.name };
    } catch {
      // A municipality that left the catalog must not stop an order.
      return null;
    }
  }

  // Background payment initiation. Never throws: a gateway failure leaves the
  // order unpaid with no attempt, which the order page offers to retry.
  private async initiatePayment(
    orderId: string,
    resolved: ResolvedPaymentMethod,
  ): Promise<void> {
    try {
      const order = (await this.orderRepository.findOne({
        where: { id: orderId },
      })) as Order;
      await this.paymentsService.createChargeForOrder(order, resolved);
    } catch (err) {
      this.logger.error(
        `Payment initiation failed for order ${orderId}`,
        err instanceof Error ? err.stack : String(err),
      );
    }
  }

  async findForClient(
    clientId: string,
    page?: number,
    limit?: number,
  ): Promise<PaginatedResponse<OrderResponseDto>> {
    const params = getPaginationParams({ page, limit });
    const [orders, total] = await this.orderRepository.findAndCount({
      // withDeleted below is for the product join; the orders themselves must
      // still respect their own soft delete.
      where: { clientId, deletedAt: IsNull() },
      relations: { items: { product: true } },
      withDeleted: true, // soft-deleted products must still render on old orders
      order: { createdAt: 'DESC' },
      skip: params.skip,
      take: params.limit,
    });
    return buildPaginatedResponse(
      await this.withPaymentMethods(orders),
      total,
      params.page,
      params.limit,
    );
  }

  async findOneForClient(
    clientId: string,
    id: string,
  ): Promise<OrderResponseDto> {
    const order = await this.orderRepository.findOne({
      where: { id, clientId },
      relations: { items: { product: true } },
      withDeleted: true,
    });
    if (!order || order.deletedAt) {
      throw new NotFoundException(`Order with id "${id}" not found`);
    }
    const dto = OrderResponseDto.fromEntity(order);
    dto.payment = await this.paymentsService.latestChargeDto(order.id);
    dto.paymentMethod = (
      await this.paymentsService.latestMethodsFor([order.id])
    ).get(order.id);
    return dto;
  }

  // Customers may back out only while the order is pending (not yet accepted).
  async cancelByClient(
    clientId: string,
    id: string,
  ): Promise<OrderResponseDto> {
    const order = await this.orderRepository.findOne({
      where: { id, clientId },
    });
    if (!order) {
      throw new NotFoundException(`Order with id "${id}" not found`);
    }
    if (order.status !== OrderStatus.PENDING) {
      throw new ConflictException(
        `Only pending orders can be cancelled (current status: ${order.status})`,
      );
    }
    await this.dataSource.transaction(async (manager) => {
      await this.inventoryService.releaseReservations(manager, order.id);
      const previous = order.status;
      order.status = OrderStatus.CANCELLED;
      await manager.getRepository(Order).save(order);
      await this.orderEvents.record(manager, {
        orderId: order.id,
        kind: OrderEventKind.STATUS_CHANGED,
        actor: { clientId },
        field: 'status',
        previousValue: previous,
        nextValue: OrderStatus.CANCELLED,
        reason: 'Cancelado por el cliente desde la tienda',
      });
    });
    return this.findOneForClient(clientId, id);
  }

  // ---------------- Admin ----------------

  /**
   * Los filtros del listado, en un solo sitio.
   *
   * Vivían dentro de `findAllAdmin`, y el reporte en PDF (MxH-0120) necesita
   * exactamente los mismos: si cada uno armara su consulta, acabarían diciendo
   * cosas distintas y un informe que no cuadra con la pantalla es peor que no
   * tenerlo.
   */
  private aplicarFiltros(
    qb: SelectQueryBuilder<Order>,
    query: AdminOrdersQueryDto,
  ): void {
    if (query.id) {
      qb.andWhere('order.id IN (:...ids)', { ids: query.id.split(',') });
    }
    if (query.clientId) {
      qb.andWhere('order.clientId = :clientId', { clientId: query.clientId });
    }
    if (query.q) {
      qb.andWhere(
        `(${sinTildes('order.orderNumber')} OR ${sinTildes('client.email')}
          OR ${sinTildes('client.firstName')} OR ${sinTildes('client.lastName')}
          OR ${sinTildes("concat_ws(' ', client.firstName, client.lastName)")}
          OR ${sinTildes('client.phone')})`,
        { q: `%${query.q}%` },
      );
    }
    if (query.status) {
      qb.andWhere('order.status = :status', { status: query.status });
    }
    if (query.paymentStatus) {
      qb.andWhere('order.paymentStatus = :paymentStatus', {
        paymentStatus: query.paymentStatus,
      });
    }
    if (query.paymentMethod) {
      // El método de un pedido es el de su **último** intento, que es lo que
      // muestra la columna (`latestMethodsFor`). Un `EXISTS` sobre cualquier
      // intento sería más corto y mentiría: hay pedidos que probaron Tropipay y
      // reintentaron con otra cosa, y saldrían al filtrar por una pasarela
      // mientras la tabla muestra la otra.
      qb.andWhere(
        query.paymentMethod === SIN_METODO_DE_PAGO
          ? // `"order"` entrecomillado: es palabra reservada en SQL, y aquí dentro
            // no pasa por la sustitución de alias de TypeORM.
            `NOT EXISTS (SELECT 1 FROM payment_charges c WHERE c.order_id = "order"."id")`
          : `(SELECT c.provider FROM payment_charges c
                WHERE c.order_id = "order"."id"
                ORDER BY c.created_at DESC, c.id DESC
                LIMIT 1) = :paymentMethod`,
        query.paymentMethod === SIN_METODO_DE_PAGO
          ? {}
          : { paymentMethod: query.paymentMethod },
      );
    }
    if (query.from) {
      qb.andWhere('order.createdAt >= :desde', { desde: new Date(query.from) });
    }
    if (query.to) {
      // Hasta el final de ese día: quien pide «hasta el 24» cuenta con los
      // pedidos de esa tarde, no con que se corten a medianoche del 23.
      const hasta = new Date(query.to);
      hasta.setHours(23, 59, 59, 999);
      qb.andWhere('order.createdAt <= :hasta', { hasta });
    }
    if (query.fulfillmentType) {
      qb.andWhere('order.fulfillmentType = :fulfillmentType', {
        fulfillmentType: query.fulfillmentType,
      });
    }
    if (query.pickupLocationId) {
      qb.andWhere('order.pickupLocationId = :pickupLocationId', {
        pickupLocationId: query.pickupLocationId,
      });
    }
    // El total es `decimal`: se compara contra texto para no pasar por el
    // `number` de JavaScript, que en importes de cinco cifras redondea
    // céntimos y dejaría pedidos fuera del rango por un cent.
    if (query.minTotal) {
      qb.andWhere('order.total >= :minTotal', { minTotal: query.minTotal });
    }
    if (query.maxTotal) {
      qb.andWhere('order.total <= :maxTotal', { maxTotal: query.maxTotal });
    }
    if (query.needsTransfer) {
      // Pickup orders still holding RESERVED stock away from their counter —
      // derived from the reservations so it clears itself once settled.
      qb.andWhere(`order.fulfillment_type = 'pickup'`).andWhere(
        `EXISTS (SELECT 1 FROM inventory_reservations r
           WHERE r.order_id = order.id AND r.status = 'reserved'
             AND r.location_id <> order.pickup_location_id)`,
      );
    }
  }

  async findAllAdmin(
    query: AdminOrdersQueryDto,
  ): Promise<PaginatedResponse<OrderResponseDto>> {
    const { page, limit, skip } = getPaginationParams(query);
    const qb = this.orderRepository
      .createQueryBuilder('order')
      .leftJoinAndSelect('order.client', 'client');

    this.aplicarFiltros(qb, query);

    const sortColumns: Record<string, string> = {
      orderNumber: 'order.orderNumber',
      status: 'order.status',
      paymentStatus: 'order.paymentStatus',
      total: 'order.total',
      createdAt: 'order.createdAt',
    };
    const sortColumn = sortColumns[query.sortBy ?? ''] ?? 'order.createdAt';
    const dir = (query.sortOrder ?? 'desc').toUpperCase() as 'ASC' | 'DESC';
    // id as deterministic tiebreaker (same rationale as the users list).
    qb.orderBy(sortColumn, dir)
      .addOrderBy('order.id', 'DESC')
      .skip(skip)
      .take(limit);

    const [orders, total] = await qb.getManyAndCount();
    return buildPaginatedResponse(
      await this.withPaymentMethods(orders),
      total,
      page,
      limit,
    );
  }

  /**
   * Todos los pedidos que casen con el filtro, sin paginar: el listado enseña
   * de diez en diez y un reporte de la página que estás mirando no es un
   * reporte. El tope existe para que una petición sin filtros no se lleve la
   * tabla entera por delante.
   */
  async findAllForReport(
    query: AdminOrdersQueryDto,
    tope = 5000,
  ): Promise<{
    pedidos: OrderResponseDto[];
    total: number;
    recortado: boolean;
  }> {
    const qb = this.orderRepository
      .createQueryBuilder('order')
      .leftJoinAndSelect('order.client', 'client');
    this.aplicarFiltros(qb, query);
    qb.orderBy('order.createdAt', 'DESC').addOrderBy('order.id', 'DESC');

    const total = await qb.getCount();
    const orders = await qb.take(tope).getMany();
    return {
      pedidos: await this.withPaymentMethods(orders),
      total,
      recortado: total > tope,
    };
  }

  /**
   * Los totales del reporte, por estado.
   *
   * Se calculan en la base sobre **todo** el conjunto filtrado, no sumando en
   * memoria las filas que se trajeron: si el filtro abarca 152 pedidos y la
   * tabla se recortó en el tope, sumar lo traído haría que el PDF dijera un
   * número y la realidad fuera otra. Un informe que no cuadra es peor que no
   * tenerlo.
   */
  async totalesForReport(
    query: AdminOrdersQueryDto,
  ): Promise<{ estado: string; pedidos: number; importe: string }[]> {
    const qb = this.orderRepository
      .createQueryBuilder('order')
      .leftJoin('order.client', 'client');
    this.aplicarFiltros(qb, query);
    const filas = await qb
      .select('order.status', 'estado')
      .addSelect('COUNT(*)', 'pedidos')
      .addSelect('COALESCE(SUM(order.total), 0)', 'importe')
      .groupBy('order.status')
      .orderBy('order.status', 'ASC')
      .getRawMany<{ estado: string; pedidos: string; importe: string }>();
    return filas.map((f) => ({
      estado: f.estado,
      pedidos: Number(f.pedidos),
      importe: f.importe,
    }));
  }

  /**
   * El resumen del reporte: cuántos pedidos y cuánto dinero por día, semana o
   * mes del rango elegido.
   *
   * Lo agrupa la base con `date_trunc`, no JavaScript: son las mismas filas que
   * ya cuenta el motor, y traérselas para sumarlas aquí sería pedir 5000 filas
   * para escribir doce.
   *
   * La semana de Postgres empieza en lunes, que es como se cuenta aquí.
   */
  async resumenPorPeriodo(
    query: AdminOrdersQueryDto,
    periodo: 'day' | 'week' | 'month',
  ): Promise<{ periodo: string; pedidos: number; importe: string }[]> {
    const qb = this.orderRepository
      .createQueryBuilder('order')
      .leftJoin('order.client', 'client');
    this.aplicarFiltros(qb, query);
    const filas = await qb
      .select(`date_trunc('${periodo}', order.createdAt)`, 'periodo')
      .addSelect('COUNT(*)', 'pedidos')
      .addSelect('COALESCE(SUM(order.total), 0)', 'importe')
      .groupBy('1')
      .orderBy('1', 'ASC')
      .getRawMany<{ periodo: Date; pedidos: string; importe: string }>();
    return filas.map((f) => ({
      periodo: new Date(f.periodo).toISOString(),
      pedidos: Number(f.pedidos),
      importe: f.importe,
    }));
  }

  async findOneAdmin(id: string): Promise<OrderResponseDto> {
    const order = await this.orderRepository.findOne({
      where: { id },
      relations: { client: true, items: { product: true } },
      withDeleted: true,
    });
    if (!order || order.deletedAt) {
      throw new NotFoundException(`Order with id "${id}" not found`);
    }
    const dto = OrderResponseDto.fromEntity(order);
    dto.payment = await this.paymentsService.latestChargeDto(order.id);
    dto.paymentMethod = (
      await this.paymentsService.latestMethodsFor([order.id])
    ).get(order.id);
    await this.attachReservationStorages(dto, order);
    return dto;
  }

  // Where the order's stock actually sits. A pickup order still holding
  // RESERVED stock at a storage other than its counter needs the admin to
  // coordinate a transfer before the customer shows up.
  private async attachReservationStorages(
    dto: OrderResponseDto,
    order: Order,
  ): Promise<void> {
    if (order.fulfillmentType !== FulfillmentType.PICKUP) return;

    const rows: {
      location_id: string;
      name: string;
      product_id: string;
      status: string;
      quantity: number;
    }[] = await this.orderRepository.manager.query(
      `SELECT r.location_id, sl.name, r.product_id, r.status,
              SUM(r.quantity)::int AS quantity
         FROM inventory_reservations r
         JOIN stock_locations sl ON sl.id = r.location_id
        WHERE r.order_id = $1 AND r.status IN ('reserved', 'confirmed')
        GROUP BY r.location_id, sl.name, r.product_id, r.status
        ORDER BY sl.name`,
      [order.id],
    );

    const storages = new Map<string, string>();
    for (const row of rows) storages.set(row.location_id, row.name);
    dto.reservationStorages = [...storages.entries()].map(
      ([locationId, locationName]) => ({ locationId, locationName }),
    );

    // The misplaced lines, grouped by source storage: one group = one transfer
    // operation the admin can run. Names come from the order's own snapshots.
    const nameByProduct = new Map(
      (order.items ?? []).map((item) => [
        item.productId,
        item.productNameSnapshot,
      ]),
    );
    const pending = new Map<
      string,
      NonNullable<OrderResponseDto['pendingTransfers']>[number]
    >();
    for (const row of rows) {
      if (row.status !== 'reserved') continue;
      if (row.location_id === order.pickupLocationId) continue;
      const group = pending.get(row.location_id) ?? {
        locationId: row.location_id,
        locationName: row.name,
        items: [],
      };
      group.items.push({
        productId: row.product_id,
        name: nameByProduct.get(row.product_id) ?? row.product_id,
        quantity: row.quantity,
      });
      pending.set(row.location_id, group);
    }
    dto.pendingTransfers = [...pending.values()];
    dto.needsTransfer = dto.pendingTransfers.length > 0;
  }

  async updateStatus(
    user: User,
    id: string,
    status: OrderStatus,
    direct = false,
    pickedUpBy?: PickedUpByDto,
  ): Promise<OrderResponseDto> {
    const order = await this.orderRepository.findOne({ where: { id } });
    if (!order) {
      throw new NotFoundException(`Order with id "${id}" not found`);
    }

    if (direct) {
      await this.assertDirectJump(user, order, status);
    } else {
      if (!TRANSITIONS[order.status].includes(status)) {
        throw new ConflictException(
          `Cannot move order from "${order.status}" to "${status}"`,
        );
      }
      // Confirm/cancel commit or release stock — admin-level decisions. Any
      // non-admin granted `orders:update-status` is limited to advancing
      // fulfillment.
      if (!isSystemAdmin(user.role) && !STAFF_TARGETS.includes(status)) {
        throw new ForbiddenException(
          'Non-admin staff can only advance fulfillment (processing, shipped, delivered)',
        );
      }
    }

    // El estado con el que entró, para no mandar correo cuando alguien vuelve
    // a marcar lo que ya estaba marcado.
    const previoAlCambio = order.status;

    // A jump still owes the side effects of the steps it skips: stock is
    // committed exactly once when the order passes (or lands on) confirmed,
    // and released when it lands on cancelled.
    const crossesConfirmed =
      order.status === OrderStatus.PENDING &&
      status !== OrderStatus.CANCELLED &&
      FORWARD_CHAIN.indexOf(status) >=
        FORWARD_CHAIN.indexOf(OrderStatus.CONFIRMED);

    await this.dataSource.transaction(async (manager) => {
      if (crossesConfirmed) {
        // The hold becomes a physical stock decrement, logged as an OUT sale.
        await this.inventoryService.confirmReservations(
          manager,
          order.id,
          user.id,
        );
      } else if (status === OrderStatus.CANCELLED) {
        // Releases holds; restocks (logged as IN) allocations already confirmed.
        await this.inventoryService.releaseReservations(
          manager,
          order.id,
          user.id,
        );
      }
      const previous = order.status;
      order.status = status;
      if (status === OrderStatus.DELIVERED && !order.deliveredAt) {
        this.sealDelivery(order, user, pickedUpBy);
      }
      await manager.getRepository(Order).save(order);
      if (status === OrderStatus.DELIVERED && previous !== status) {
        await this.orderEvents.record(manager, {
          orderId: order.id,
          kind: OrderEventKind.DELIVERED,
          actor: { userId: user.id },
          field: 'deliveredAt',
          nextValue: order.deliveredAt?.toISOString() ?? null,
          reason: 'Pedido entregado',
          meta: { pickedUpBy: order.pickedUpBy },
        });
      }
      await this.orderEvents.record(manager, {
        orderId: order.id,
        kind: OrderEventKind.STATUS_CHANGED,
        actor: { userId: user.id },
        field: 'status',
        previousValue: previous,
        nextValue: status,
        meta: direct ? { direct: true } : null,
      });
    });
    // Fuera de la transacción y sin await: avisar no puede tumbar ni demorar
    // el cambio de estado, igual que con el correo del pago. Si el envío
    // falla, queda anotado en `email_log` con su motivo.
    if (previoAlCambio !== status) {
      this.avisarDelCambio(order.id, status, order.cancellationReason ?? null);
    }
    return this.findOneAdmin(id);
  }

  /**
   * Qué cambios de estado se le cuentan al cliente. Son tres de seis: de
   * `confirmed` y `processing` no se avisa —el cliente acaba de recibir el
   * correo del pago y no aportan nada que él pueda hacer—, y `pending` es
   * donde nace el pedido.
   */
  private avisarDelCambio(
    orderId: string,
    status: OrderStatus,
    motivo: CancellationReason | null,
  ): void {
    if (status === OrderStatus.SHIPPED) {
      void this.orderMailer.shipped(orderId);
    } else if (status === OrderStatus.DELIVERED) {
      void this.orderMailer.delivered(orderId);
    } else if (status === OrderStatus.CANCELLED) {
      void this.orderMailer.cancelled(orderId, motivo);
    }
  }

  // Direct jumps skip the step chain but never its rules of physics: forward
  // only (or to cancelled), never out of a terminal state, and reserved for
  // whoever runs manual in-store sales — a grantable permission, so admins
  // decide per role. The step-by-step path stays the safe default.
  private async assertDirectJump(
    user: User,
    order: Order,
    status: OrderStatus,
  ): Promise<void> {
    const allowed = await this.permissionsService.hasPermission(
      user.id,
      user.role,
      'orders',
      'update-status-direct',
    );
    if (!allowed) {
      throw new ForbiddenException(
        'You need the direct status-change permission to do this',
      );
    }
    if (TRANSITIONS[order.status].length === 0) {
      throw new ConflictException(
        `Order is already ${order.status}; nothing to change`,
      );
    }
    if (status === order.status) {
      throw new ConflictException(`Order is already ${status}`);
    }
    if (
      status !== OrderStatus.CANCELLED &&
      FORWARD_CHAIN.indexOf(status) <= FORWARD_CHAIN.indexOf(order.status)
    ) {
      throw new ConflictException(
        `Cannot move order backwards from "${order.status}" to "${status}"`,
      );
    }
  }

  /**
   * «Restablecer orden»: devuelve a `pending` un pedido cancelado y vuelve a
   * apartar su stock. Toca SOLO el estado del pedido — el del pago queda como
   * estaba — y reinicia el plazo de pago vía `reinstatedAt`: si nadie lo paga
   * dentro de la ventana, la caducidad lo vuelve a cancelar. Si falta stock de
   * alguna línea no se cambia nada y se responde 409 nombrando el producto.
   * Solo administradores (el controlador lo exige por rol).
   */
  async reinstate(user: User, id: string): Promise<OrderResponseDto> {
    const order = await this.orderRepository.findOne({ where: { id } });
    if (!order) {
      throw new NotFoundException(`Order with id "${id}" not found`);
    }
    if (order.status !== OrderStatus.CANCELLED) {
      throw new ConflictException(
        `Only cancelled orders can be reinstated (current status: "${order.status}")`,
      );
    }
    if (
      order.cancellationReason ===
      CancellationReason.PAID_AFTER_EXPIRY_OUT_OF_STOCK
    ) {
      throw new ConflictException(
        'This order was paid after expiring and its stock was gone: it needs a refund, not a reinstatement',
      );
    }

    // Same storage rules as a fresh checkout: only storages covering the
    // delivery municipality, and the pickup counter first for a pickup.
    const allowedLocationIds = await this.allowedLocationsFor(order);

    await this.dataSource.transaction(async (manager) => {
      await this.reserveOrderItems(
        manager,
        order,
        allowedLocationIds,
        'restablecer el pedido',
      );
      const previous = order.status;
      order.status = OrderStatus.PENDING;
      order.cancellationReason = null;
      order.reinstatedAt = new Date();
      order.reinstatedBy = user.id;
      await manager.getRepository(Order).save(order);
      await this.orderEvents.record(manager, {
        orderId: order.id,
        kind: OrderEventKind.REINSTATED,
        actor: { userId: user.id },
        field: 'status',
        previousValue: previous,
        nextValue: OrderStatus.PENDING,
        reason:
          'Restablecida desde la administración; el plazo de pago vuelve a empezar',
      });
    });
    this.logger.log(
      `Order ${order.orderNumber ?? order.id} reinstated by user ${user.id}: back to pending, stock re-reserved`,
    );
    return this.findOneAdmin(id);
  }

  // Manual override (refunds, gateway-outage corrections). Guarded so an
  // admin can't produce nonsense like paid -> pending.
  async updatePaymentStatus(
    user: User,
    id: string,
    paymentStatus: PaymentStatus,
  ): Promise<OrderResponseDto> {
    const order = await this.orderRepository.findOne({ where: { id } });
    if (!order) {
      throw new NotFoundException(`Order with id "${id}" not found`);
    }
    if (!PAYMENT_TRANSITIONS[order.paymentStatus].includes(paymentStatus)) {
      throw new ConflictException(
        `Cannot move payment from "${order.paymentStatus}" to "${paymentStatus}"`,
      );
    }
    const previous = order.paymentStatus;
    order.paymentStatus = paymentStatus;
    // El reloj de la custodia y el plazo de entrega arrancan también cuando
    // el pago se marca a mano; si no, el pedido nunca entraría ni en los
    // recordatorios ni en lo comprometido.
    if (paymentStatus === PaymentStatus.PAID) {
      sellarCobro(order);
    }
    await this.orderRepository.save(order);
    await this.orderEvents.record(null, {
      orderId: order.id,
      kind: OrderEventKind.PAYMENT_STATUS_CHANGED,
      actor: { userId: user.id },
      field: 'paymentStatus',
      previousValue: previous,
      nextValue: paymentStatus,
      reason: 'Marcado a mano desde la administración',
    });
    // Marcar pagado a mano es hoy la vía normal —la pasarela lleva semanas
    // rechazando—, así que el cliente tiene que enterarse igual que si hubiera
    // entrado por webhook. La corrección de superadmin no avisa: ahí se está
    // arreglando un dato, no confirmando un cobro.
    if (
      paymentStatus === PaymentStatus.PAID &&
      previous !== PaymentStatus.PAID &&
      order.status !== OrderStatus.CANCELLED
    ) {
      void this.orderMailer.paymentReceived(order.id);
    }
    return this.findOneAdmin(id);
  }

  /**
   * Deja constancia de la entrega: cuándo, quién la registró y a quién se le
   * dio. Desde `deliveredAt` cuenta el plazo para reclamar, así que la fecha
   * se sella una sola vez: una corrección posterior no la reescribe.
   */
  private sealDelivery(
    order: Order,
    user: User,
    pickedUpBy?: PickedUpByDto,
  ): void {
    order.deliveredAt = new Date();
    order.deliveredBy = user.id;
    const contact = order.contactSnapshot as {
      name?: string;
      fullName?: string;
      idCard?: string;
    } | null;
    const name = pickedUpBy?.name ?? contact?.fullName ?? contact?.name ?? null;
    const idCard = pickedUpBy?.idCard ?? contact?.idCard ?? null;
    order.pickedUpBy = name || idCard ? { name, idCard } : null;
  }

  /** Almacenes donde este pedido puede apartar stock: los que cubren su municipio, y su mostrador. */
  private async allowedLocationsFor(
    order: Order,
  ): Promise<string[] | undefined> {
    const coveringIds = order.deliveryMunicipalityId
      ? await this.productsService.coveringLocationIds({
          municipalityId: order.deliveryMunicipalityId,
        })
      : undefined;
    return coveringIds && order.pickupLocationId
      ? [...new Set([...coveringIds, order.pickupLocationId])]
      : coveringIds;
  }

  /** Vuelve a apartar cada línea del pedido; 409 nombrando el producto si falta. */
  private async reserveOrderItems(
    manager: EntityManager,
    order: Order,
    allowedLocationIds: string[] | undefined,
    purpose: string,
  ): Promise<void> {
    const items = await manager
      .getRepository(OrderItem)
      .find({ where: { orderId: order.id } });
    for (const item of items) {
      try {
        await this.inventoryService.reserve(
          manager,
          order.id,
          item.productId,
          item.quantity,
          {
            allowedLocationIds,
            preferredLocationId: order.pickupLocationId ?? undefined,
          },
        );
      } catch (err) {
        if (err instanceof ConflictException) {
          throw new ConflictException(
            `No hay stock suficiente de "${item.productNameSnapshot}" (${item.quantity}) para ${purpose}`,
          );
        }
        throw err;
      }
    }
  }

  /**
   * Corrección de superadministrador: cualquier estado de pedido y de pago,
   * en cualquier dirección, con el efecto que toca sobre el stock:
   *
   *   liberado (cancelado)        → retenido (pendiente): vuelve a apartar
   *   liberado                    → comprometido (confirmado en adelante): aparta y descuenta
   *   retenido                    → comprometido: descuenta
   *   retenido                    → liberado: libera
   *   comprometido                → retenido: devuelve al almacén y vuelve a apartar
   *   comprometido                → liberado: devuelve al almacén
   *
   * Si el resultado es «pendiente y sin pagar», el plazo de pago vuelve a
   * empezar desde ahora, como en un restablecimiento: si no, un pedido viejo
   * caducaría en el siguiente barrido. Todo queda en el historial con el
   * motivo y la marca de corrección.
   */
  async correct(
    user: User,
    id: string,
    dto: CorrectOrderDto,
  ): Promise<OrderResponseDto> {
    if (user.role !== Role.SUPER_ADMIN) {
      throw new ForbiddenException(
        'Only a super admin can correct an order freely',
      );
    }
    if (dto.status === undefined && dto.paymentStatus === undefined) {
      throw new BadRequestException(
        'Nothing to correct: pass a status, a payment status, or both',
      );
    }
    const order = await this.orderRepository.findOne({ where: { id } });
    if (!order) {
      throw new NotFoundException(`Order with id "${id}" not found`);
    }
    const fromStatus = order.status;
    const toStatus = dto.status ?? order.status;
    const fromPayment = order.paymentStatus;
    const toPayment = dto.paymentStatus ?? order.paymentStatus;
    if (fromStatus === toStatus && fromPayment === toPayment) {
      throw new ConflictException('The order is already in that state');
    }

    const allowedLocationIds =
      stockPhase(fromStatus) !== stockPhase(toStatus) &&
      stockPhase(toStatus) !== 'released'
        ? await this.allowedLocationsFor(order)
        : undefined;

    await this.dataSource.transaction(async (manager) => {
      if (fromStatus !== toStatus) {
        const from = stockPhase(fromStatus);
        const to = stockPhase(toStatus);
        if (from !== to) {
          if (from === 'committed') {
            // Devuelve al almacén lo que ya se había descontado (queda como IN).
            await this.inventoryService.releaseReservations(
              manager,
              order.id,
              user.id,
            );
          } else if (from === 'held' && to === 'released') {
            await this.inventoryService.releaseReservations(
              manager,
              order.id,
              user.id,
            );
          }
          if (to === 'held' || to === 'committed') {
            if (from !== 'held') {
              await this.reserveOrderItems(
                manager,
                order,
                allowedLocationIds,
                'corregir el pedido',
              );
            }
            if (to === 'committed') {
              await this.inventoryService.confirmReservations(
                manager,
                order.id,
                user.id,
              );
            }
          }
        }
        order.status = toStatus;
        if (toStatus === OrderStatus.CANCELLED) {
          order.cancellationReason = null;
        } else if (fromStatus === OrderStatus.CANCELLED) {
          order.cancellationReason = null;
        }
      }
      if (fromPayment !== toPayment) {
        order.paymentStatus = toPayment;
        if (toPayment === PaymentStatus.PAID) {
          sellarCobro(order);
        } else if (fromPayment === PaymentStatus.PAID) {
          // Deshacer un cobro deshace lo que colgaba de él: no hay plazo que
          // contar desde un pago que ya no existe, ni custodia que corra.
          deshacerCobro(order);
        }
      }
      if (
        order.status === OrderStatus.PENDING &&
        order.paymentStatus !== PaymentStatus.PAID &&
        (fromStatus !== OrderStatus.PENDING ||
          fromPayment === PaymentStatus.PAID)
      ) {
        order.reinstatedAt = new Date();
        order.reinstatedBy = user.id;
      }
      await manager.getRepository(Order).save(order);

      if (fromStatus !== toStatus) {
        await this.orderEvents.record(manager, {
          orderId: order.id,
          kind: OrderEventKind.STATUS_CHANGED,
          actor: { userId: user.id },
          field: 'status',
          previousValue: fromStatus,
          nextValue: toStatus,
          reason: dto.reason,
          meta: { correction: true },
        });
      }
      if (fromPayment !== toPayment) {
        await this.orderEvents.record(manager, {
          orderId: order.id,
          kind: OrderEventKind.PAYMENT_STATUS_CHANGED,
          actor: { userId: user.id },
          field: 'paymentStatus',
          previousValue: fromPayment,
          nextValue: toPayment,
          reason: dto.reason,
          meta: { correction: true },
        });
      }
    });
    this.logger.warn(
      `Order ${order.orderNumber ?? order.id} corrected by super admin ${user.id}: ` +
        `${fromStatus}/${fromPayment} -> ${toStatus}/${toPayment} (${dto.reason})`,
    );
    return this.findOneAdmin(id);
  }

  /**
   * Corrección de las líneas de un pedido (capa 3): cambiar cantidades, quitar
   * productos y añadir otros, con el total recalculado y el stock puesto al
   * día. Solo superadministradores.
   *
   * Se recibe el pedido **como debe quedar** y aquí se deduce qué cambió. El
   * stock se mueve según la fase en la que esté el pedido:
   *
   *   cancelado (liberado)  → no se toca stock: no hay nada apartado
   *   pendiente (retenido)  → sube: aparta la diferencia; baja: la suelta
   *   confirmado en adelante (comprometido) → sube: aparta y descuenta la
   *                            diferencia (queda como salida); baja: la devuelve
   *                            al almacén (queda como entrada)
   *
   * Las bajadas se aplican antes que las subidas: quien cambia un producto por
   * otro libera stock que la subida puede necesitar. Si falta stock para alguna
   * subida, no se guarda nada y se responde 409 nombrando el producto.
   */
  async updateItems(
    user: User,
    id: string,
    dto: UpdateOrderItemsDto,
  ): Promise<OrderResponseDto> {
    if (user.role !== Role.SUPER_ADMIN) {
      throw new ForbiddenException(
        'Only a super admin can edit the lines of an order',
      );
    }
    const productIds = dto.items.map((line) => line.productId);
    if (new Set(productIds).size !== productIds.length) {
      throw new BadRequestException(
        'Un producto no puede aparecer dos veces; súmalo en una sola línea',
      );
    }
    // **Sin `relations: { items }` a propósito.** Guardar más abajo un pedido que
    // lleva su colección de líneas cargada hace que TypeORM reconcilie esa
    // colección contra la base y borre lo que no esté en ella — incluida la
    // línea que esta misma transacción acaba de insertar. Pasó en staging el
    // 17-sep-2026 con ORD-20260134: la reserva de stock quedó hecha y la línea
    // desapareció. Las líneas se leen aparte y el pedido se actualiza por campos.
    const order = await this.orderRepository.findOne({ where: { id } });
    if (!order) {
      throw new NotFoundException(`Order with id "${id}" not found`);
    }

    const itemsRepo = this.orderRepository.manager.getRepository(OrderItem);
    const current = new Map(
      (await itemsRepo.find({ where: { orderId: id } })).map((item) => [
        item.productId,
        item,
      ]),
    );
    // El catálogo solo hace falta para las líneas nuevas: las que ya estaban
    // conservan su nombre y su precio de entonces.
    const incoming = await this.resolveLines(dto.items, current);

    const changes: Record<string, unknown>[] = [];
    for (const line of incoming) {
      const existing = current.get(line.productId);
      if (!existing) {
        changes.push({
          type: 'added',
          productId: line.productId,
          name: line.name,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
        });
        continue;
      }
      if (existing.quantity !== line.quantity) {
        changes.push({
          type: 'quantity',
          productId: line.productId,
          name: line.name,
          from: existing.quantity,
          to: line.quantity,
        });
      }
      if (Number(existing.unitPrice) !== Number(line.unitPrice)) {
        changes.push({
          type: 'price',
          productId: line.productId,
          name: line.name,
          from: Number(existing.unitPrice).toFixed(2),
          to: line.unitPrice.toFixed(2),
        });
      }
    }
    const incomingIds = new Set(incoming.map((line) => line.productId));
    for (const item of current.values()) {
      if (!incomingIds.has(item.productId)) {
        changes.push({
          type: 'removed',
          productId: item.productId,
          name: item.productNameSnapshot,
          quantity: item.quantity,
        });
      }
    }
    if (changes.length === 0) {
      throw new ConflictException('El pedido ya tiene esas líneas');
    }

    const phase = stockPhase(order.status);
    const allowedLocationIds =
      phase === 'released' ? undefined : await this.allowedLocationsFor(order);

    const previousTotal = Number(order.total);
    const subtotal = incoming.reduce(
      (sum, line) => sum + Math.round(line.unitPrice * line.quantity * 100),
      0,
    );
    const nextSubtotal = (subtotal / 100).toFixed(2);
    const nextTotal = (subtotal / 100 + Number(order.deliveryFee)).toFixed(2);

    await this.dataSource.transaction(async (manager) => {
      if (phase !== 'released') {
        // Primero lo que libera stock (quitadas y bajadas), después lo que lo
        // pide: cambiar un producto por otro no debe fallar por un hueco que la
        // propia corrección acaba de abrir.
        for (const item of current.values()) {
          const line = incoming.find((l) => l.productId === item.productId);
          const drop = line ? item.quantity - line.quantity : item.quantity;
          if (drop > 0) {
            await this.inventoryService.releaseProductUnits(
              manager,
              order.id,
              item.productId,
              drop,
              user.id,
            );
          }
        }
        for (const line of incoming) {
          const existing = current.get(line.productId);
          const rise = line.quantity - (existing?.quantity ?? 0);
          if (rise <= 0) continue;
          try {
            await this.inventoryService.reserve(
              manager,
              order.id,
              line.productId,
              rise,
              {
                allowedLocationIds,
                preferredLocationId: order.pickupLocationId ?? undefined,
              },
            );
          } catch (err) {
            if (err instanceof ConflictException) {
              throw new ConflictException(
                `No hay stock suficiente de "${line.name}" (faltan ${rise}) para corregir el pedido`,
              );
            }
            throw err;
          }
          if (phase === 'committed') {
            // El resto del pedido ya salió del almacén; esta parte se iguala.
            await this.inventoryService.confirmProductReservations(
              manager,
              order.id,
              line.productId,
              user.id,
            );
          }
        }
      }

      const itemRepo = manager.getRepository(OrderItem);
      for (const item of current.values()) {
        if (!incomingIds.has(item.productId)) await itemRepo.remove(item);
      }
      for (const line of incoming) {
        const existing = current.get(line.productId);
        const lineTotal = (
          Math.round(line.unitPrice * line.quantity * 100) / 100
        ).toFixed(2);
        if (existing) {
          existing.quantity = line.quantity;
          existing.unitPrice = line.unitPrice.toFixed(2);
          existing.lineTotal = lineTotal;
          await itemRepo.save(existing);
        } else {
          await itemRepo.save(
            itemRepo.create({
              orderId: order.id,
              productId: line.productId,
              productNameSnapshot: line.name,
              unitPrice: line.unitPrice.toFixed(2),
              quantity: line.quantity,
              lineTotal,
            }),
          );
        }
      }

      order.subtotal = nextSubtotal;
      order.total = nextTotal;
      // Por campos, no por entidad: ver el comentario de arriba. `save` de un
      // pedido cuya relación `items` pueda estar cargada se lleva por delante
      // las líneas recién insertadas.
      await manager
        .getRepository(Order)
        .update(order.id, { subtotal: nextSubtotal, total: nextTotal });

      await this.orderEvents.record(manager, {
        orderId: order.id,
        kind: OrderEventKind.ITEMS_CHANGED,
        actor: { userId: user.id },
        field: 'items',
        reason: dto.reason,
        meta: { correction: true, changes },
      });
      if (previousTotal !== Number(nextTotal)) {
        await this.orderEvents.record(manager, {
          orderId: order.id,
          kind: OrderEventKind.TOTAL_CHANGED,
          actor: { userId: user.id },
          field: 'total',
          previousValue: previousTotal.toFixed(2),
          nextValue: nextTotal,
          reason: dto.reason,
          meta: {
            correction: true,
            subtotal: nextSubtotal,
            deliveryFee: order.deliveryFee,
            // Con el pedido ya cobrado, la diferencia es dinero que hay que
            // cobrar (positiva) o devolver (negativa) fuera del sistema.
            paidDifference:
              order.paymentStatus === PaymentStatus.PAID
                ? (Number(nextTotal) - previousTotal).toFixed(2)
                : undefined,
          },
        });
      }
    });

    this.logger.warn(
      `Order ${order.orderNumber ?? order.id} lines corrected by super admin ${user.id}: ` +
        `${changes.length} change(s), total ${previousTotal.toFixed(2)} -> ${nextTotal} (${dto.reason})`,
    );
    return this.findOneAdmin(id);
  }

  /**
   * Cada línea pedida, con el nombre y el precio que le tocan: las que ya
   * estaban conservan los suyos (salvo que se mande otro precio), y las nuevas
   * los toman del catálogo. Un producto nuevo tiene que existir y estar a la
   * venta; uno retirado del catálogo puede seguir en el pedido que lo compró,
   * pero no se añade a otro.
   */
  private async resolveLines(
    lines: UpdateOrderItemsDto['items'],
    current: Map<string, OrderItem>,
  ): Promise<
    { productId: string; name: string; quantity: number; unitPrice: number }[]
  > {
    const resolved: {
      productId: string;
      name: string;
      quantity: number;
      unitPrice: number;
    }[] = [];
    for (const line of lines) {
      const existing = current.get(line.productId);
      if (existing) {
        resolved.push({
          productId: line.productId,
          name: existing.productNameSnapshot,
          quantity: line.quantity,
          unitPrice: line.unitPrice ?? Number(existing.unitPrice),
        });
        continue;
      }
      const product = await this.productsService.findOne(line.productId);
      if (!product.isActive || product.deletedAt) {
        throw new ConflictException(
          `"${product.name}" no está a la venta; no se puede añadir al pedido`,
        );
      }
      resolved.push({
        productId: line.productId,
        name: product.name,
        quantity: line.quantity,
        // Misma fórmula que el carrito y la ficha de producto.
        unitPrice:
          line.unitPrice ??
          Math.round(
            Number(product.basePrice) *
              (1 - Number(product.discount) / 100) *
              100,
          ) / 100,
      });
    }
    return resolved;
  }

  /** Todos los intentos de pago del pedido, del más reciente al más antiguo. */
  async listPaymentAttempts(id: string) {
    const exists = await this.orderRepository.findOne({
      where: { id },
      select: { id: true },
    });
    if (!exists) {
      throw new NotFoundException(`Order with id "${id}" not found`);
    }
    const charges = await this.paymentsService.listChargesFor(id);
    return charges.map((charge) => this.paymentsService.toDto(charge));
  }

  /** Quita un intento de pago que nunca se completó. Solo superadministradores. */
  async removePaymentAttempt(
    user: User,
    id: string,
    chargeId: string,
    reason: string,
  ): Promise<OrderResponseDto> {
    if (user.role !== Role.SUPER_ADMIN) {
      throw new ForbiddenException(
        'Only a super admin can remove a payment attempt',
      );
    }
    const order = await this.orderRepository.findOne({ where: { id } });
    if (!order) {
      throw new NotFoundException(`Order with id "${id}" not found`);
    }
    const removed = await this.paymentsService.removeAttempt(id, chargeId);
    if (order.paymentRef === removed.reference) {
      order.paymentRef = null;
      await this.orderRepository.save(order);
    }
    await this.orderEvents.record(null, {
      orderId: order.id,
      kind: OrderEventKind.PAYMENT_ATTEMPT_REMOVED,
      actor: { userId: user.id },
      reason,
      meta: {
        correction: true,
        provider: removed.provider,
        reference: removed.reference,
        chargeStatus: removed.status,
      },
    });
    return this.findOneAdmin(id);
  }

  /**
   * Seguimiento público: el estado de un pedido a partir del identificador que
   * viaja en el enlace, **sin sesión**.
   *
   * Un identificador que no existe y uno mal formado responden exactamente
   * igual —404, sin cuerpo que los distinga—: si el error dijera «formato
   * inválido» frente a «no encontrado», estaría confirmando cuáles tienen la
   * forma buena, que es media pista para quien prueba a ciegas.
   *
   * Lo que se devuelve lo acota `OrderTrackingResponseDto`, que se construye
   * campo a campo. El historial sale de `order_events`, filtrado a los cambios
   * de estado: los intentos de pago y los comprobantes no son asunto de quien
   * recibe el enlace.
   */
  async trackByPublicId(trackingId: string): Promise<OrderTrackingResponseDto> {
    const noExiste = new NotFoundException('Pedido no encontrado');
    // 64 caracteres hexadecimales; cualquier otra cosa ni se consulta.
    if (!/^[0-9a-f]{64}$/.test(trackingId)) throw noExiste;

    const order = await this.orderRepository.findOne({
      where: { trackingId },
    });
    if (!order || order.deletedAt) throw noExiste;

    const eventos = await this.orderEvents.listForOrder(order.id);
    const history = eventos
      // Por el campo que tocan, no por el tipo de evento: un pedido llega a
      // «cancelado» tanto por una cancelación como por caducar sin pagarse
      // (`expired`), y por el tipo se quedaba fuera justo ese caso, que es el
      // más frecuente. Así entra cualquier evento que mueva el estado, incluidos
      // los que se añadan después.
      .filter(
        (e) =>
          e.field === 'status' &&
          typeof e.nextValue === 'string' &&
          e.nextValue in ESTADO_PARA_EL_CLIENTE,
      )
      .map((e) => ({
        status: ESTADO_PARA_EL_CLIENTE[e.nextValue as OrderStatus],
        at: e.createdAt,
      }));

    const dto = new OrderTrackingResponseDto();
    dto.orderNumber = order.orderNumber;
    dto.status = ESTADO_PARA_EL_CLIENTE[order.status];
    dto.paid = estaPagado(order.paymentStatus);
    dto.placedAt = order.createdAt;
    dto.promiseDays = order.promiseDays ?? null;
    dto.promisedAt = order.promisedAt ?? null;
    dto.deliveredAt = order.deliveredAt ?? null;
    dto.fulfillmentType = order.fulfillmentType;
    dto.history = history;
    return dto;
  }

  /** Historial del pedido, del más antiguo al más reciente. */
  async listEvents(id: string) {
    const exists = await this.orderRepository.findOne({
      where: { id },
      select: { id: true },
    });
    if (!exists) {
      throw new NotFoundException(`Order with id "${id}" not found`);
    }
    return this.orderEvents.listForOrder(id);
  }
}
