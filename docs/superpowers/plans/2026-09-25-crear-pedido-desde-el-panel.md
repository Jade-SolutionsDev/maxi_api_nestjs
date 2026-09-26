# Crear un pedido en nombre de un cliente — Plan de implementación

> **Para quien lo ejecute:** SUB-SKILL OBLIGATORIA — usa
> `superpowers:subagent-driven-development` (recomendado) o
> `superpowers:executing-plans` para ejecutarlo tarea a tarea. Los pasos llevan
> casilla (`- [ ]`) para ir marcándolos.

**Objetivo:** que un empleado pueda registrar desde el panel el pedido de quien
compra por WhatsApp o por teléfono, sin que eso cree un segundo camino de
creación de pedidos.

**Arquitectura:** se extrae de `checkout()` un núcleo privado `crearPedido()`
que recibe las líneas ya valoradas y hace la transacción (cabecera, reservas,
líneas, evento). La tienda y el panel resuelven sus líneas cada uno por su lado
y llaman al mismo núcleo. El panel no lanza la pasarela.

**Tecnologías:** NestJS + TypeORM + PostgreSQL (Jest) en la API; React 19 +
ra-core + shadcn (Playwright/playwright-bdd) en el panel.

**Spec:** `docs/superpowers/specs/2026-09-25-crear-pedido-desde-el-panel-design.md`

**Repos:** tareas 1-7 en `maxi_api_nestjs`; tareas 8-10 en `maxi_admin_react`.
Rama en ambos: `feature/pedido-desde-el-panel`, sacada de `develop`.

## Restricciones globales

- **Un solo camino de creación.** Ninguna tarea puede duplicar la lógica de
  reserva, totales o evento de creación. Si una tarea parece pedir una copia de
  `checkout()`, está mal planteada: para y dilo.
- **El cobro al crear va dentro de la misma transacción** que crea el pedido.
  Nunca en una segunda llamada: el barrido de caducidad puede pasar por el hueco
  y cancelar una venta ya cobrada.
- **`order.clientId` es obligatorio** y no se toca. No existen pedidos sin cliente.
- **El panel nunca crea intentos de pago.** Un intento es una sesión de cobro a
  nombre del comprador.
- **Idioma del código nuevo:** nombres y comentarios en español, como el código
  reciente de este repo (`sellarCobro`, `aplicarFiltros`, `avisarDelCambio`).
  Los mensajes de error de cara al cliente, en español.
- **Commits:** uno por tarea como mínimo, con el cuerpo explicando *por qué*.
- **Antes de empezar:** `git pull` en `develop` y rebase. El compañero acaba de
  meter `d783738` (arreglos del reporte por correo).

---

### Tarea 1: El permiso `orders:create`

**Ficheros:**
- Modificar: `src/permissions/permissions.service.ts:91` (el bloque `orders` de `MODULE_ACTIONS`)
- Probar: `src/permissions/permissions.service.spec.ts`

**Interfaces:**
- Consume: nada.
- Produce: la acción `'create'` dentro de `MODULE_ACTIONS.orders`, que las
  tareas 6 y 10 usan como `@RequirePermission({ module: 'orders', action: 'create' })`
  y como `<RequireAccess resource="orders" action="create">`.

- [ ] **Paso 1: Escribir la prueba que falla**

En `src/permissions/permissions.service.spec.ts`, dentro del `describe` que ya
comprueba el catálogo:

```ts
it('ofrece «create» en pedidos, separado de los cambios de estado', () => {
  expect(MODULE_ACTIONS.orders).toContain('create');
  // Crear un pedido ajeno mueve stock e inventa deuda: no puede venir
  // colgado del permiso de avanzar uno que ya existe.
  expect(MODULE_ACTIONS.orders).toContain('update-status');
});
```

Si `MODULE_ACTIONS` no está importado en ese fichero, añádelo:
`import { MODULE_ACTIONS } from './permissions.service';`

- [ ] **Paso 2: Verla fallar**

Ejecuta: `npx jest src/permissions/permissions.service.spec.ts -t 'create'`
Esperado: FALLA — `expect(received).toContain('create')`.

- [ ] **Paso 3: Añadir la acción**

En `src/permissions/permissions.service.ts`, el bloque `orders`:

```ts
  // `create` es crear un pedido en nombre de un cliente, desde el panel: para
  // quien compra por WhatsApp o por teléfono. Va aparte de `update-status`
  // porque mueve stock e inventa deuda, que no es lo mismo que avanzar un
  // pedido que ya existe.
  // `update-status-direct` allows jumping straight to any status (manual
  // warehouse sales); `update-status` alone only advances fulfillment.
  orders: [
    'list',
    'read',
    'create',
    'update-status',
    'update-status-direct',
    'update-payment-status',
  ],
```

- [ ] **Paso 4: Verla pasar**

Ejecuta: `npx jest src/permissions/permissions.service.spec.ts`
Esperado: PASA, y el resto del fichero sigue verde.

- [ ] **Paso 5: Comprometer**

```bash
git add src/permissions/permissions.service.ts src/permissions/permissions.service.spec.ts
git commit -m "feat(permisos): orders:create, para crear pedidos en nombre de un cliente"
```

---

### Tarea 2: Extraer el núcleo `crearPedido()` de `checkout()`

Refactor **sin cambio de comportamiento**. La red de seguridad son las pruebas
que ya existen de `checkout`: tienen que seguir verdes sin tocarlas.

**Ficheros:**
- Modificar: `src/orders/orders.service.ts:219-416` (`checkout`)
- Probar: `src/orders/orders.service.spec.ts` (las de `describe('checkout')`, sin modificar)

**Interfaces:**
- Consume: `FulfillmentChoice` (`src/fulfillment/fulfillment.service.ts:39`).
- Produce:

```ts
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
  /** Suma de las líneas, ya redondeada por quien las resolvió. */
  subtotal: number;
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
```

`crearPedido(params: CrearPedidoParams): Promise<string>` devuelve el `id` del
pedido creado.

- [ ] **Paso 1: Confirmar que la red está verde ANTES de tocar nada**

Ejecuta: `npx jest src/orders/orders.service.spec.ts -t checkout`
Esperado: PASA. Anota cuántas pruebas son. Si alguna falla ya, **para**: no se
refactoriza sobre rojo.

- [ ] **Paso 2: Mover el bloque a `crearPedido`**

Corta de `checkout()` el bloque que va desde `const orderId = await this.dataSource.transaction(` hasta el `return order.id; });` y llévalo a un método privado nuevo, justo después de `checkout()`. Sustituye en el cuerpo movido:

- `client.id` → `params.clientId`
- `cart.items` → `params.lineas`
- `cart.subtotal.toFixed(2)` → `params.subtotal.toFixed(2)`
- `fulfillment` → `params.fulfillment`
- `deliveryMunicipalityId` → `params.deliveryMunicipalityId`
- `line.name` / `line.unitPrice` / `line.quantity` → los de `LineaResuelta` (mismos nombres)
- `dto.paymentMethod ?? null` → `params.paymentMethodCode`
- `actor: { clientId: client.id }` → `actor: params.actor`
- `total` → calculado dentro: `const total = (params.subtotal + Number(params.fulfillment.fee)).toFixed(2);`
- el `meta` del evento se abre a quien llama:

```ts
        meta: {
          total,
          fulfillmentType: params.fulfillment.type,
          paymentMethod: params.paymentMethodCode,
          ...params.metaExtra,
        },
```

El borrado del carrito **sale** del núcleo y se convierte en el hook:

```ts
      await params.alFinalizar?.(manager, order);
      return order.id;
```

Cabecera del método:

```ts
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
```

- [ ] **Paso 3: Dejar `checkout()` llamando al núcleo**

En `checkout()`, donde estaba el bloque:

```ts
    const orderId = await this.crearPedido({
      clientId: client.id,
      lineas: cart.items.map((line) => ({
        productId: line.productId,
        name: line.name,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
      })),
      subtotal: cart.subtotal,
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
```

Añade `import type { EntityManager } from 'typeorm';` si no está ya.

- [ ] **Paso 4: Verificar que la red sigue verde**

Ejecuta: `npx jest src/orders/orders.service.spec.ts`
Esperado: PASA, **el mismo número de pruebas que en el paso 1**, sin haber
tocado el fichero de pruebas.

- [ ] **Paso 5: Comprobar que la red mide algo (verificación por mutación)**

Un refactor que pasa las pruebas no demuestra nada si las pruebas no miran lo
movido. Rompe el núcleo a propósito y míralo fallar:

1. En `crearPedido`, cambia `status: OrderStatus.PENDING` por `OrderStatus.CONFIRMED`.
2. Ejecuta `npx jest src/orders/orders.service.spec.ts -t checkout` → **tiene que FALLAR**.
3. Deshaz el cambio y vuelve a verde.
4. Repite con el hook: comenta la línea `await params.alFinalizar?.(manager, order);` → **tiene que fallar** la prueba que comprueba que el carrito se vacía.
5. Deshaz.

Si alguna de las dos mutaciones **no** hace fallar nada, la red no cubre el
núcleo: escribe la prueba que falta antes de seguir.

- [ ] **Paso 6: Comprometer**

```bash
git add src/orders/orders.service.ts
git commit -m "refactor(pedidos): un solo sitio donde nace un pedido"
```

---

### Tarea 3: El DTO del alta desde el panel

**Ficheros:**
- Crear: `src/orders/dto/create-order-for-client.dto.ts`
- Probar: `src/orders/dto/create-order-for-client.dto.spec.ts`

**Interfaces:**
- Consume: `OrderLineDto` (`src/orders/dto/update-order-items.dto.ts`), `CheckoutContactDto` (`src/orders/dto/checkout.dto.ts`).
- Produce: `CreateOrderForClientDto`, que consumen las tareas 4, 5 y 6.

- [ ] **Paso 1: Escribir la prueba que falla**

```ts
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { CreateOrderForClientDto } from './create-order-for-client.dto';

const base = {
  clientId: '11111111-1111-4111-8111-111111111111',
  items: [{ productId: '22222222-2222-4222-8222-222222222222', quantity: 2 }],
};

const errores = (payload: unknown) =>
  validateSync(plainToInstance(CreateOrderForClientDto, payload), {
    whitelist: true,
  });

describe('CreateOrderForClientDto', () => {
  it('acepta lo mínimo: un cliente y una línea', () => {
    expect(errores(base)).toHaveLength(0);
  });

  it('exige al menos una línea', () => {
    expect(errores({ ...base, items: [] }).length).toBeGreaterThan(0);
  });

  it('exige el cliente: no hay pedidos sin cliente', () => {
    const { clientId, ...sinCliente } = base;
    expect(errores(sinCliente).length).toBeGreaterThan(0);
  });

  it('acepta el cobro ya hecho, con su método', () => {
    expect(
      errores({ ...base, cobro: { paymentMethod: 'manual', reference: 'TRF-9912' } }),
    ).toHaveLength(0);
  });

  it('rechaza un cobro sin método de pago', () => {
    expect(errores({ ...base, cobro: { reference: 'TRF-9912' } }).length)
      .toBeGreaterThan(0);
  });
});
```

- [ ] **Paso 2: Verla fallar**

Ejecuta: `npx jest src/orders/dto/create-order-for-client.dto.spec.ts`
Esperado: FALLA — no existe el módulo.

- [ ] **Paso 3: Escribir el DTO**

```ts
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { CheckoutContactDto } from './checkout.dto';
import { OrderLineDto } from './update-order-items.dto';
import { FulfillmentType } from '../entities/order.entity';

/**
 * Un cobro que ya ocurrió fuera del sistema: una transferencia, o efectivo en
 * el mostrador. No abre ningún intento de pago; solo deja constancia.
 */
export class CobroYaHechoDto {
  /** Código del método por el que se cobró (ver GET /payment-methods). */
  @IsString()
  @IsNotEmpty()
  @MaxLength(32)
  paymentMethod: string;

  /** Referencia de la transferencia, número de recibo… Va al historial. */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  reference?: string;
}

/**
 * Un pedido que hace un empleado en nombre de un cliente, para quien compra por
 * WhatsApp o por teléfono.
 *
 * Deliberadamente **no** acepta `addressId`: el panel manda la dirección
 * escrita, porque quien atiende el teléfono la está oyendo, no eligiéndola de
 * la libreta del cliente.
 */
export class CreateOrderForClientDto {
  /** El cliente a cuyo nombre va el pedido. Obligatorio siempre. */
  @IsUUID()
  clientId: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => OrderLineDto)
  items: OrderLineDto[];

  @IsOptional()
  @IsEnum(FulfillmentType)
  fulfillmentType?: FulfillmentType;

  @IsOptional()
  @IsUUID()
  deliveryOptionId?: string;

  @IsOptional()
  @IsUUID()
  pickupAddressId?: string;

  @IsOptional()
  @IsObject()
  deliveryAddress?: Record<string, unknown>;

  @IsOptional()
  @IsUUID()
  deliveryMunicipalityId?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => CheckoutContactDto)
  contact?: CheckoutContactDto;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  paymentMethod?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  customerNotes?: string;

  /** Presente solo si ya se cobró por fuera. Exige el permiso de cobros. */
  @IsOptional()
  @ValidateNested()
  @Type(() => CobroYaHechoDto)
  cobro?: CobroYaHechoDto;
}
```

- [ ] **Paso 4: Verla pasar**

Ejecuta: `npx jest src/orders/dto/create-order-for-client.dto.spec.ts`
Esperado: PASA, 5 pruebas.

- [ ] **Paso 5: Comprometer**

```bash
git add src/orders/dto/create-order-for-client.dto.ts src/orders/dto/create-order-for-client.dto.spec.ts
git commit -m "feat(pedidos): DTO del alta de pedido desde el panel"
```

---

### Tarea 4: `crearParaCliente()` — el alta, sin cobro todavía

**Ficheros:**
- Modificar: `src/orders/orders.service.ts` (método público nuevo, junto a `checkout`)
- Probar: `src/orders/orders.service.spec.ts` (bloque `describe('crearParaCliente')` nuevo)

**Interfaces:**
- Consume: `crearPedido()` (tarea 2), `CreateOrderForClientDto` (tarea 3),
  `this.resolveLines(items, new Map())` (`orders.service.ts:1586` — ya valora
  contra el catálogo y rechaza productos no vendibles; con el mapa vacío trata
  todas las líneas como nuevas, que es justo lo que hace falta aquí),
  `this.productsService.availableForArea(ids, area)` (`products.service.ts:253`).
- Produce: `crearParaCliente(user: User, dto: CreateOrderForClientDto): Promise<OrderResponseDto>`,
  que consumen las tareas 5, 6 y 7.

- [ ] **Paso 1: Escribir las pruebas que fallan**

Añade al final de `src/orders/orders.service.spec.ts`, antes del cierre del
`describe('OrdersService')`:

```ts
  describe('crearParaCliente', () => {
    const dtoBase = {
      clientId: 'client-1',
      items: [{ productId: 'prod-2', quantity: 3 }],
    };

    beforeEach(() => {
      orderRepo.findOne.mockResolvedValue(makeOrder({ items: [] }));
      productsService.availableForArea = jest
        .fn()
        .mockResolvedValue(new Map([['prod-2', 10]]));
      clientRepo.findOne.mockResolvedValue({
        id: 'client-1',
        defaultMunicipalityId: 'mun-1',
      });
    });

    it('crea el pedido a nombre del cliente y aparta su stock', async () => {
      await service.crearParaCliente(makeUser(Role.ADMIN), dtoBase);

      expect(inventoryService.reserve).toHaveBeenCalledWith(
        expect.anything(),
        'order-1',
        'prod-2',
        3,
        expect.anything(),
      );
      expect(orderRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ clientId: 'client-1' }),
      );
    });

    it('NO toca el carrito del cliente', async () => {
      await service.crearParaCliente(makeUser(Role.ADMIN), dtoBase);

      // Es la razón de ser del refactor: el empleado no puede borrarle al
      // cliente lo que tenga dentro de su carrito.
      expect(cartItemRepo.delete).not.toHaveBeenCalled();
      expect(cartService.getCart).not.toHaveBeenCalled();
    });

    it('deja en el historial al empleado, no al cliente', async () => {
      await service.crearParaCliente(makeUser(Role.ADMIN), dtoBase);

      expect(orderEvents.record).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          kind: OrderEventKind.CREATED,
          actor: { userId: 'user-1' },
          meta: expect.objectContaining({ canal: 'back-office' }),
        }),
      );
    });

    it('no abre ningún intento de pago: eso lo hace el cliente', async () => {
      await service.crearParaCliente(makeUser(Role.ADMIN), dtoBase);

      expect(paymentsService.createChargeForOrder).not.toHaveBeenCalled();
    });

    it('manda el correo de «tenemos tu pedido»', async () => {
      await service.crearParaCliente(makeUser(Role.ADMIN), dtoBase);

      expect(mailer.orderReceived).toHaveBeenCalledWith('order-1');
      expect(mailer.paymentReceived).not.toHaveBeenCalled();
    });

    it('sin cobro nace pendiente y sin sellar: el barrido lo cogerá', async () => {
      await service.crearParaCliente(makeUser(Role.ADMIN), dtoBase);

      const guardado = orderRepo.save.mock.calls.at(-1)?.[0];
      expect(guardado.status).toBe(OrderStatus.PENDING);
      expect(guardado.paymentStatus).toBe(PaymentStatus.PENDING);
      // Sin `paidAt` no hay cobro que proteja la reserva: caduca como
      // cualquier otra, que es lo que se decidió.
      expect(guardado.paidAt ?? null).toBeNull();
    });

    it('404 si el cliente no existe', async () => {
      clientRepo.findOne.mockResolvedValue(null);

      await expect(
        service.crearParaCliente(makeUser(Role.ADMIN), dtoBase),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('409 con el detalle por línea si no hay stock en la zona', async () => {
      productsService.availableForArea.mockResolvedValue(
        new Map([['prod-2', 1]]),
      );

      await expect(
        service.crearParaCliente(makeUser(Role.ADMIN), dtoBase),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(inventoryService.reserve).not.toHaveBeenCalled();
    });
  });
```

En el montaje del módulo (el `beforeEach` grande) añade el repositorio de
clientes, que hoy no está:

```ts
  let clientRepo: { findOne: jest.Mock };
  // …dentro del beforeEach:
  clientRepo = { findOne: jest.fn() };
  // …y en el array de providers:
  { provide: getRepositoryToken(Client), useValue: clientRepo },
```

`Client` ya está importado en ese fichero (`../clients/entities/client.entity`).

**Por qué el repositorio y no `ClientsService`:** el módulo de pedidos no
importa hoy `ClientsModule`, y meterlo arriesga una dependencia circular
(clientes ya conoce pedidos). Solo hace falta leer una fila.

- [ ] **Paso 2: Verlas fallar**

Ejecuta: `npx jest src/orders/orders.service.spec.ts -t crearParaCliente`
Esperado: FALLA — `service.crearParaCliente is not a function`.

- [ ] **Paso 3: Escribir el método**

Primero, el acceso a clientes. En `src/orders/orders.module.ts` añade `Client`
al `forFeature` de la línea 30:

```ts
    TypeOrmModule.forFeature([Order, OrderItem, User, UserRole, Client]),
```

con `import { Client } from '../clients/entities/client.entity';`. Y en el
constructor de `OrdersService`:

```ts
    @InjectRepository(Client)
    private readonly clientRepository: Repository<Client>,
```

No se inyecta `ClientsService`: el módulo de pedidos no importa `ClientsModule`
y hacerlo arriesga una circular (clientes ya conoce pedidos). Aquí solo hace
falta leer una fila.

```ts
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
    const client = await this.clientRepository.findOne({
      where: { id: dto.clientId },
    });
    if (!client) {
      throw new NotFoundException(`No existe el cliente "${dto.clientId}"`);
    }

    const productIds = dto.items.map((line) => line.productId);
    if (new Set(productIds).size !== productIds.length) {
      throw new BadRequestException(
        'Un producto no puede aparecer dos veces; súmalo en una sola línea',
      );
    }

    // Mismo valorador que usa la corrección de líneas: precio del catálogo con
    // su descuento, o el que escriba quien atiende si pactó otro por teléfono.
    const lineas = await this.resolveLines(dto.items, new Map());

    const deliveryMunicipalityId =
      dto.deliveryMunicipalityId ?? client.defaultMunicipalityId ?? undefined;

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
    const disponible = await this.productsService.availableForArea(
      productIds,
      { municipalityId: deliveryMunicipalityId },
    );
    const faltan = lineas.filter(
      (line) => (disponible.get(line.productId) ?? 0) < line.quantity,
    );
    if (faltan.length > 0) {
      throw new ConflictException({
        message: 'Some cart items are no longer available',
        details: faltan.map((line) => ({
          field: line.productId,
          message: `"${line.name}": only ${disponible.get(line.productId) ?? 0} available`,
          available: disponible.get(line.productId) ?? 0,
        })),
      });
    }

    const resolvedPayment = dto.paymentMethod
      ? await this.paymentMethodsService.resolve(dto.paymentMethod)
      : null;

    const coveringIds = deliveryMunicipalityId
      ? await this.productsService.coveringLocationIds({
          municipalityId: deliveryMunicipalityId,
        })
      : undefined;
    const allowedLocationIds =
      coveringIds && fulfillment.pickupLocationId
        ? [...new Set([...coveringIds, fulfillment.pickupLocationId])]
        : coveringIds;

    const subtotal =
      Math.round(
        lineas.reduce((sum, l) => sum + l.unitPrice * l.quantity * 100, 0),
      ) / 100;

    const orderId = await this.crearPedido({
      clientId: client.id,
      lineas,
      subtotal,
      fulfillment,
      deliveryMunicipalityId,
      deliveryAddress: dto.deliveryAddress ?? null,
      contactSnapshot: dto.contact ? { ...dto.contact } : null,
      customerNotes: dto.customerNotes ?? null,
      allowedLocationIds,
      actor: { userId: user.id },
      paymentMethodCode: dto.paymentMethod ?? null,
    });

    void this.orderMailer.orderReceived(orderId).catch((err) => {
      this.logger.error(
        `No se pudo avisar por correo del pedido ${orderId}`,
        err instanceof Error ? err.stack : String(err),
      );
    });

    return this.findOneAdmin(orderId);
  }
```

Dos detalles del bloque de arriba:

- Falta `metaExtra: { canal: 'back-office' }` en la llamada a `crearPedido`:
  añádelo, es lo que hace pasar la prueba del historial. El campo ya existe en
  `CrearPedidoParams` desde la tarea 2.
- `resolvedPayment` no se usa después a propósito: está para que un método de
  pago inexistente dé 400 **antes** de escribir nada. Déjalo con ese comentario
  encima, o el linter lo marcará como variable muerta.

- [ ] **Paso 4: Verlas pasar**

Ejecuta: `npx jest src/orders/orders.service.spec.ts`
Esperado: PASA todo, incluidas las 8 nuevas y las de `checkout` sin tocar.

- [ ] **Paso 5: Comprometer**

```bash
git add src/orders/orders.service.ts src/orders/orders.service.spec.ts
git commit -m "feat(pedidos): crear un pedido en nombre de un cliente"
```

---

### Tarea 5: Marcar el pedido como cobrado al crearlo

**Ficheros:**
- Modificar: `src/orders/orders.service.ts` (`crearParaCliente`)
- Probar: `src/orders/orders.service.spec.ts` (`describe('crearParaCliente')`)

**Interfaces:**
- Consume: `crearPedido({ alFinalizar })` (tarea 2), `sellarCobro(order, cuando?)`
  (`src/orders/payment-sealing.ts:13`),
  `this.permissionsService.hasPermission(userId, role, module, action)`
  (contrato ya usado en `assertDirectJump`, `orders.service.ts:977` — cópialo de ahí).
- Produce: nada nuevo hacia fuera.

- [ ] **Paso 1: Escribir las pruebas que fallan**

Dentro de `describe('crearParaCliente')`:

```ts
    describe('cuando ya se cobró por fuera', () => {
      const conCobro = {
        ...dtoBase,
        cobro: { paymentMethod: 'manual', reference: 'TRF-9912' },
      };

      it('el pedido nace pagado y con su plazo contando', async () => {
        await service.crearParaCliente(makeUser(Role.ADMIN), conCobro);

        expect(orderRepo.save).toHaveBeenCalledWith(
          expect.objectContaining({
            paymentStatus: PaymentStatus.PAID,
            paidAt: expect.any(Date),
          }),
        );
      });

      it('deja el cobro en el historial, aparte de la creación', async () => {
        await service.crearParaCliente(makeUser(Role.ADMIN), conCobro);

        expect(orderEvents.record).toHaveBeenCalledWith(
          expect.anything(),
          expect.objectContaining({
            kind: OrderEventKind.PAYMENT_STATUS_CHANGED,
            actor: { userId: 'user-1' },
            nextValue: PaymentStatus.PAID,
          }),
        );
      });

      it('manda «hemos recibido tu pago», no «falta el pago»', async () => {
        await service.crearParaCliente(makeUser(Role.ADMIN), conCobro);

        // orderReceived dice literalmente «Todavía falta el pago» y enseña un
        // botón de pagar: en un pedido ya cobrado sería mentira.
        expect(mailer.paymentReceived).toHaveBeenCalledWith('order-1');
        expect(mailer.orderReceived).not.toHaveBeenCalled();
      });

      it('403 y NINGUNA escritura si no tiene el permiso de cobros', async () => {
        permissionsService.hasPermission.mockImplementation(
          (_u: string, _r: Role, _m: string, action: string) =>
            Promise.resolve(action !== 'update-payment-status'),
        );

        await expect(
          service.crearParaCliente(makeUser(Role.STAFF), conCobro),
        ).rejects.toBeInstanceOf(ForbiddenException);
        // La comprobación va ANTES de abrir la transacción.
        expect(orderRepo.save).not.toHaveBeenCalled();
        expect(inventoryService.reserve).not.toHaveBeenCalled();
      });

      it('sin cobro no exige el permiso de cobros', async () => {
        permissionsService.hasPermission.mockResolvedValue(false);

        await expect(
          service.crearParaCliente(makeUser(Role.STAFF), dtoBase),
        ).resolves.toBeDefined();
      });
    });
```

- [ ] **Paso 2: Verlas fallar**

Ejecuta: `npx jest src/orders/orders.service.spec.ts -t 'ya se cobró'`
Esperado: FALLA — el pedido nace pendiente.

- [ ] **Paso 3: Implementar**

En `crearParaCliente`, **antes** de resolver nada (para que el 403 no deje
rastro), la comprobación del permiso:

```ts
    if (dto.cobro && !isSystemAdmin(user.role)) {
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
```

Y el sellado, **dentro** de la transacción, por el hook:

```ts
      // Dentro de la MISMA transacción que crea el pedido, a propósito: entre
      // crear y cobrar habría un hueco con el pedido pendiente, y el barrido
      // de caducidad puede pasar por ahí y cancelar una venta ya cobrada.
      alFinalizar: dto.cobro
        ? async (manager, order) => {
            order.paymentStatus = PaymentStatus.PAID;
            order.paymentRef = dto.cobro.reference ?? null;
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
                paymentMethod: dto.cobro.paymentMethod,
                reference: dto.cobro.reference ?? null,
              },
            });
          }
        : undefined,
```

Y el correo, según el caso:

```ts
    const aviso = dto.cobro
      ? this.orderMailer.paymentReceived(orderId)
      : this.orderMailer.orderReceived(orderId);
    void aviso.catch((err) => {
      this.logger.error(
        `No se pudo avisar por correo del pedido ${orderId}`,
        err instanceof Error ? err.stack : String(err),
      );
    });
```

Importa `sellarCobro` de `./payment-sealing` e `isSystemAdmin` de
`../permissions/permissions.service` si no están ya.

- [ ] **Paso 4: Verlas pasar**

Ejecuta: `npx jest src/orders/orders.service.spec.ts`
Esperado: PASA todo.

- [ ] **Paso 5: Comprobar que la prueba del 403 mide algo**

Mueve la comprobación del permiso a **después** de `crearPedido` y ejecuta
`npx jest src/orders/orders.service.spec.ts -t 'NINGUNA escritura'`.
Esperado: **FALLA**. Si pasa, la prueba no está mirando las escrituras: arréglala
antes de seguir. Devuelve la comprobación a su sitio.

- [ ] **Paso 6: Comprometer**

```bash
git add src/orders/orders.service.ts src/orders/orders.service.spec.ts
git commit -m "feat(pedidos): marcar cobrado al crear, en la misma transacción"
```

---

### Tarea 6: El endpoint `POST /orders`

**Ficheros:**
- Modificar: `src/orders/orders.controller.ts` (ruta nueva, junto a `findAll`)
- Probar: `test/orders.e2e-spec.ts`

**Interfaces:**
- Consume: `crearParaCliente()` (tareas 4-5), `CreateOrderForClientDto` (tarea 3),
  el permiso `orders:create` (tarea 1).
- Produce: `POST /orders` → 201 con `OrderResponseDto`. Lo consume la tarea 9.

- [ ] **Paso 1: Escribir la prueba de extremo a extremo que falla**

En `test/orders.e2e-spec.ts`:

```ts
  it('POST /orders crea un pedido a nombre de un cliente', async () => {
    const res = await request(app.getHttpServer())
      .post('/orders')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        clientId,
        items: [{ productId, quantity: 2 }],
      })
      .expect(201);

    expect(res.body.data.clientId).toBe(clientId);
    expect(res.body.data.status).toBe('pending');
  });

  it('POST /orders sin el permiso responde 403', async () => {
    await request(app.getHttpServer())
      .post('/orders')
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ clientId, items: [{ productId, quantity: 1 }] })
      .expect(403);
  });
```

Reutiliza el montaje que ese fichero ya tiene (de dónde salen `adminToken`,
`staffToken`, `clientId` y `productId`); no montes uno nuevo. Si `staffToken`
no existe allí, míralo en `test/rbac.e2e-spec.ts`, que es donde se prueban los
permisos por rol.

- [ ] **Paso 2: Verla fallar**

Ejecuta: `npm run test:e2e -- orders`
Esperado: FALLA con 404 — la ruta no existe.

- [ ] **Paso 3: Escribir la ruta**

En `orders.controller.ts`, justo después de `findAll`:

```ts
  @Post()
  @RequirePermission({ module: 'orders', action: 'create' })
  @ApiOperation({
    summary: 'Create an order on behalf of a client',
    description:
      'For customers who buy over WhatsApp or by phone. The order is born ' +
      'exactly like a storefront one — same reservations, same expiry — but ' +
      'the client cart is untouched and no payment attempt is opened: the ' +
      'customer starts it from their own order page. Pass `cobro` to record ' +
      'a payment already taken outside the system; that also requires ' +
      '`orders:update-payment-status`.',
  })
  @ApiCreatedResponse({ type: OrderResponseDto })
  @ApiConflictResponse({ description: 'Not enough stock in the client area.' })
  crearParaCliente(
    @Req() req: AuthenticatedUserRequest,
    @Body() dto: CreateOrderForClientDto,
  ): Promise<OrderResponseDto> {
    return this.ordersService.crearParaCliente(req.user, dto);
  }
```

Importa `Post` de `@nestjs/common`, `ApiCreatedResponse` de `@nestjs/swagger` y
el DTO, si no están ya.

- [ ] **Paso 4: Verla pasar**

Ejecuta: `npm run test:e2e -- orders`
Esperado: PASA.

- [ ] **Paso 5: Comprometer**

```bash
git add src/orders/orders.controller.ts test/
git commit -m "feat(api): POST /orders para crear a nombre de un cliente"
```

---

### Tarea 7: La prueba que impide que los dos caminos se separen

Es la prueba que justifica el diseño entero. Va sola en su tarea porque es el
único artefacto que sigue teniendo valor dentro de un año.

**Ficheros:**
- Crear: `src/orders/crear-pedido.equivalencia.spec.ts`

**Interfaces:**
- Consume: `checkout()` y `crearParaCliente()`.
- Produce: nada.

- [ ] **Paso 1: Escribir la prueba**

Monta el servicio igual que `orders.service.spec.ts` (copia su `beforeEach`; es
largo, pero un fichero de pruebas que depende del montaje de otro es peor).
Luego:

```ts
describe('la tienda y el panel crean el mismo pedido', () => {
  // El mismo pedido por las dos vías: dos unidades de prod-1 a 7,50, entrega
  // a domicilio sin recargo. Si los dos caminos divergen algún día en stock,
  // totales o plazo, esta prueba lo dice antes que un cliente.
  const mismasLineas = { productId: 'prod-1', quantity: 2, unitPrice: 7.5 };

  it('aparta el mismo stock, calcula el mismo total y congela el mismo plazo', async () => {
    cartService.getCart.mockResolvedValue({
      items: [cartLine],
      totalItems: 2,
      subtotal: 15,
    });
    orderRepo.findOne.mockResolvedValue(makeOrder({ items: [] }));

    await service.checkout(makeClient(), {});
    const porLaTienda = {
      reserva: inventoryService.reserve.mock.calls.at(-1),
      pedido: orderRepo.save.mock.calls.at(-1)?.[0],
    };

    jest.clearAllMocks();
    clientRepo.findOne.mockResolvedValue({
      id: 'client-1',
      defaultMunicipalityId: 'mun-1',
    });
    productsService.availableForArea.mockResolvedValue(
      new Map([['prod-1', 10]]),
    );
    orderRepo.findOne.mockResolvedValue(makeOrder({ items: [] }));

    await service.crearParaCliente(makeUser(Role.ADMIN), {
      clientId: 'client-1',
      items: [mismasLineas],
    });
    const porElPanel = {
      reserva: inventoryService.reserve.mock.calls.at(-1),
      pedido: orderRepo.save.mock.calls.at(-1)?.[0],
    };

    // Mismo producto, misma cantidad, mismos almacenes permitidos.
    expect(porElPanel.reserva?.slice(2)).toEqual(porLaTienda.reserva?.slice(2));
    // Mismo dinero y mismo compromiso de entrega.
    expect(porElPanel.pedido.subtotal).toBe(porLaTienda.pedido.subtotal);
    expect(porElPanel.pedido.total).toBe(porLaTienda.pedido.total);
    expect(porElPanel.pedido.promiseDays).toBe(porLaTienda.pedido.promiseDays);
    expect(porElPanel.pedido.fulfillmentType).toBe(
      porLaTienda.pedido.fulfillmentType,
    );
    // Y el mismo estado de salida: pendiente de pago.
    expect(porElPanel.pedido.status).toBe(porLaTienda.pedido.status);
    expect(porElPanel.pedido.paymentStatus).toBe(
      porLaTienda.pedido.paymentStatus,
    );
  });
});
```

`cartLine` (en `orders.service.spec.ts:70`) ya es `prod-1 × 2` a 7,50: los dos
caminos piden exactamente lo mismo.

- [ ] **Paso 2: Verla pasar**

Ejecuta: `npx jest src/orders/crear-pedido.equivalencia.spec.ts`
Esperado: PASA.

- [ ] **Paso 3: Comprobar que mide algo — el paso que NO puedes saltarte**

Una prueba de equivalencia que pasa pase lo que pase es peor que no tenerla:
da confianza falsa. Rómpela a propósito tres veces y míralas fallar:

1. En `crearParaCliente`, suma `+ 1` al `subtotal` → **tiene que FALLAR**.
2. Pásale a `crearPedido` un `fulfillment` con `promiseDays: 99` → **tiene que FALLAR**.
3. Cambia `actor: { userId: user.id }` por `{ clientId: client.id }` → esta
   **debe seguir pasando** (el actor es lo único que sí difiere entre los dos
   caminos; si falla, la prueba está comparando de más).

Deshaz las tres.

- [ ] **Paso 4: Comprometer**

```bash
git add src/orders/crear-pedido.equivalencia.spec.ts
git commit -m "test(pedidos): la tienda y el panel tienen que crear el mismo pedido"
```

- [ ] **Paso 5: La API entera en verde, y el linter**

```bash
npx jest
npm run lint
npm run test:e2e
```

Los tres tienen que pasar antes de tocar el panel. CI usa `eslint`, no
`prettier`: validar con el otro ya costó una subida rechazada.

---

## Panel — `maxi_admin_react`

**Ojo con la validación:** este repo **no tiene pruebas unitarias**. Sus redes
son `npm run build` (que ejecuta `tsc -b`), `npm run lint` y los escenarios de
Playwright de `e2e/features/`. Cada tarea del panel termina pasando los tres.

---

### Tarea 8: Sacar el selector de productos a un componente compartido

Refactor **sin cambio de comportamiento**: el editor de líneas tiene que seguir
funcionando exactamente igual.

**Ficheros:**
- Crear: `src/pages/orders/SelectorDeLineas.tsx`
- Modificar: `src/pages/orders/OrderItemsEditor.tsx:85-330` (usa el componente nuevo)

**Interfaces:**
- Consume: `useGetList('products', …)` de `ra-core`.
- Produce:

```tsx
export interface EditableLine {
  productId: string;
  name: string;
  quantity: number;
  unitPrice: number;
}

export function SelectorDeLineas({
  lines,
  onChange,
  /** Precios editables. El editor de pedidos los deja tocar; el alta también. */
  allowPriceEdit = true,
}: {
  lines: EditableLine[];
  onChange: (lines: EditableLine[]) => void;
  allowPriceEdit?: boolean;
}): React.ReactElement;
```

La tarea 10 lo consume con esa firma exacta.

- [ ] **Paso 1: Ver el editor funcionando ANTES de tocarlo**

```bash
npm run build && npm run lint
npx playwright test e2e/features/pedidos.feature
```

Esperado: los tres pasan. Si algo ya falla, **para**.

- [ ] **Paso 2: Crear el componente**

Mueve a `SelectorDeLineas.tsx`, tal cual, del `OrderItemsEditor`:

- `export interface EditableLine` (hoy en la línea 33)
- los helpers `money` y `round` (líneas 39-46)
- el `useState` de `search` y el `useGetList('products', …)` (líneas 105-117)
- todo el JSX de la búsqueda, la lista de resultados y la tabla de líneas con
  sus botones de `Plus` / `Minus` / `Trash2`

El componente **no** sabe de pedidos, ni de motivos, ni de guardar: solo recibe
líneas y devuelve líneas. Cabecera:

```tsx
/**
 * Elegir productos y cantidades para un pedido.
 *
 * Lo usan dos pantallas: la corrección de líneas de un pedido que ya existe y
 * el alta de un pedido desde el panel. Está compartido a propósito — dos
 * selectores separados acabarían enseñando stock distinto, que es justo lo que
 * pasó con el reporte de pedidos antes de compartir el constructor de filtros.
 */
```

- [ ] **Paso 3: Dejar que `OrderItemsEditor` lo use**

En `OrderItemsEditor.tsx`, sustituye el JSX movido por:

```tsx
            <SelectorDeLineas lines={lines} onChange={setLines} />
```

y reexporta el tipo para no romper a quien lo importe de aquí:

```tsx
export type { EditableLine } from "./SelectorDeLineas";
```

El resto del editor —el `reason`, el resumen de cambios, el `save`— **no se
toca**.

- [ ] **Paso 4: Comprobar que nada cambió**

```bash
npm run build && npm run lint
npx playwright test e2e/features/pedidos.feature
```

Esperado: los tres pasan, igual que en el paso 1.

Y míralo con los ojos: `npm run dev`, abre un pedido pendiente, «Editar
líneas», busca un producto, súbele la cantidad, cámbiale el precio. Tiene que
comportarse igual que antes.

- [ ] **Paso 5: Comprometer**

```bash
git add src/pages/orders/SelectorDeLineas.tsx src/pages/orders/OrderItemsEditor.tsx
git commit -m "refactor(panel): un solo selector de productos para pedidos"
```

---

### Tarea 9: `createOrderForClient` en el dataProvider

**Ficheros:**
- Modificar: `src/providers/dataProvider.ts` (interfaz `ExtendedDataProvider` ~línea 231, e implementación ~línea 732)

**Interfaces:**
- Consume: `POST /orders` (tarea 6), `OrderLinePayload` (ya existe en este fichero).
- Produce:

```ts
export interface CreateOrderForClientPayload {
  clientId: string;
  items: OrderLinePayload[];
  fulfillmentType?: "delivery" | "pickup";
  deliveryOptionId?: string;
  pickupAddressId?: string;
  deliveryAddress?: Record<string, unknown>;
  deliveryMunicipalityId?: string;
  contact?: { recipientName: string; idCard: string; contactPhone: string };
  paymentMethod?: string;
  customerNotes?: string;
  cobro?: { paymentMethod: string; reference?: string };
}

createOrderForClient: (
  payload: CreateOrderForClientPayload,
) => Promise<{ data: { id: string; orderNumber: string } }>;
```

La tarea 10 lo consume con esa firma exacta.

- [ ] **Paso 1: Añadir el tipo y la firma**

Pon `CreateOrderForClientPayload` junto a `InviteClientPayload`, y la firma
dentro de `ExtendedDataProvider`, al lado de `updateOrderItems`.

- [ ] **Paso 2: Implementar**

Junto a `inviteClient` (línea ~732), con el mismo patrón:

```ts
  /**
   * Un pedido que hacemos nosotros en nombre del cliente: quien compra por
   * WhatsApp o por teléfono.
   *
   * No es `create('orders', …)`: ra-core mandaría el recurso entero, y este
   * endpoint recibe lo que se pide, no un pedido ya montado.
   */
  async createOrderForClient(payload: CreateOrderForClientPayload) {
    const { json } = await httpClient(`${API_URL}/orders`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
    return {
      data: unwrapOne(json) as { id: string; orderNumber: string },
    };
  },
```

- [ ] **Paso 3: Comprobar**

```bash
npm run build && npm run lint
```

Esperado: pasan.

- [ ] **Paso 4: Comprometer**

```bash
git add src/providers/dataProvider.ts
git commit -m "feat(panel): createOrderForClient contra POST /orders"
```

---

### Tarea 10: El formulario de alta

**Ficheros:**
- Crear: `src/pages/orders/CrearPedidoDialog.tsx`
- Modificar: `src/pages/orders/OrdersList.tsx:144-149` (el botón en la barra)
- Modificar: `src/i18n/es.json` y `src/i18n/en.json` (bloque `orders.create`)
- Crear: `e2e/features/crear-pedido.feature` y sus pasos

**Interfaces:**
- Consume: `SelectorDeLineas` (tarea 8), `createOrderForClient` (tarea 9),
  `InviteClientModal` (`src/pages/clients/InviteClientModal.tsx`, ya existe),
  `RequireAccess` (ya se usa en `App.tsx`).
- Produce: nada.

- [ ] **Paso 1: Las traducciones**

En `src/i18n/es.json`, dentro del bloque `"orders"` (línea ~807):

```json
    "create": {
      "button": "Crear pedido",
      "title": "Crear un pedido para un cliente",
      "subtitle": "Para quien compra por WhatsApp o por teléfono.",
      "client": "Cliente",
      "client_missing": "¿No tiene cuenta? Invítalo",
      "lines": "Productos",
      "fulfillment": "Entrega",
      "payment": "Pago",
      "already_paid": "Ya está cobrado",
      "already_paid_hint": "Marca esto solo si el dinero ya entró: por transferencia o en el mostrador.",
      "reference": "Referencia del cobro",
      "notes": "Notas",
      "submit": "Crear el pedido",
      "created": "Pedido %{orderNumber} creado",
      "no_stock": "No hay stock suficiente para algún producto"
    },
```

El mismo bloque en `en.json`, traducido.

- [ ] **Paso 2: El diálogo**

Crea `CrearPedidoDialog.tsx` siguiendo el patrón de `InviteClientModal.tsx`
(mismo `Dialog` de shadcn, mismo manejo de errores con `useNotify`). Estructura:

```tsx
export function CrearPedidoDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [clientId, setClientId] = useState<string | null>(null);
  const [lines, setLines] = useState<EditableLine[]>([]);
  const [yaCobrado, setYaCobrado] = useState(false);
  // …
}
```

Secciones, en este orden: cliente (autocompletar con
`useGetList('clients', { filter: { q: busqueda } })`, con el enlace que abre
`InviteClientModal`), `<SelectorDeLineas lines={lines} onChange={setLines} />`,
entrega, pago con la casilla «ya cobrado», y notas.

La casilla «ya cobrado» **solo se pinta** si el usuario tiene el permiso:
envuélvela en `<RequireAccess resource="orders" action="update-payment-status">`.
Que el botón exista sin permiso solo sirve para que la API conteste 403.

El botón de crear se deshabilita mientras no haya cliente y al menos una línea.

- [ ] **Paso 3: El botón en el listado**

En `OrdersList.tsx`, en la barra de acciones:

```tsx
          <div className="flex items-center gap-2">
            <RequireAccess resource="orders" action="create">
              <Button onClick={() => setCrearAbierto(true)}>
                {translate("orders.create.button", { _: "Crear pedido" })}
              </Button>
            </RequireAccess>
            <ExportOrdersButton />
            <RefreshButton />
          </div>
```

más el `useState` y `<CrearPedidoDialog open={crearAbierto} onOpenChange={setCrearAbierto} />`.

- [ ] **Paso 4: El escenario de navegador**

Crea `e2e/features/crear-pedido.feature`:

```gherkin
# language: es
Característica: Crear un pedido en nombre de un cliente

  Quien compra por WhatsApp o por teléfono no pasa por la tienda, y su venta
  tiene que quedar registrada igual que las demás: mismo stock apartado, mismo
  plazo, mismo correo. Si esto no existe, esas ventas viven en una libreta.

  Escenario: El botón solo aparece con permiso para crear
    Cuando abre el listado de "pedidos"
    Entonces ve el botón "Crear pedido"

  Escenario: No se puede crear un pedido sin cliente y sin productos
    Cuando abre el listado de "pedidos"
    Y pulsa "Crear pedido"
    Entonces el botón "Crear el pedido" está deshabilitado
```

Escribe los pasos que falten en `e2e/steps/` siguiendo los que ya existen; no
inventes un montaje nuevo.

- [ ] **Paso 5: Comprobar**

```bash
npm run build && npm run lint
npx playwright test e2e/features/crear-pedido.feature
```

Esperado: pasan.

- [ ] **Paso 6: Probarlo a mano, de verdad**

`npm run dev`, y crea un pedido real contra la API local:

1. Un cliente que exista, dos productos, entrega a domicilio. Créalo.
2. Abre el pedido: tiene que estar **pendiente**, con su stock apartado y el
   empleado en el historial.
3. Mira el carrito de ese cliente en la tienda: **tiene que seguir intacto**.
4. Repite marcando «ya cobrado»: el pedido nace **pagado**, con su plazo
   contando, y el correo que sale es el de «hemos recibido tu pago».

- [ ] **Paso 7: Comprometer**

```bash
git add src/pages/orders/CrearPedidoDialog.tsx src/pages/orders/OrdersList.tsx src/i18n/ e2e/
git commit -m "feat(panel): crear un pedido en nombre de un cliente"
```

---

## Al terminar

- [ ] Las dos ramas verdes: `npx jest && npm run lint && npm run test:e2e` en la
      API; `npm run build && npm run lint && npx playwright test` en el panel.
- [ ] **No mezclar a `develop` todavía.** La regla del repo: a `develop` solo
      entra lo que está listo para producción, y esto lo valida Jade primero.
- [ ] Escribir el nodo en el grafo: una decisión en `/home/jade/kb/decisiones/`
      sobre el núcleo único de creación de pedidos, con el número leído de
      `ls /home/jade/kb/decisiones/` en ese momento (no deducido de aquí), y
      `python3 /home/jade/kb/indice.py` después.
- [ ] Mover la tarjeta de Trello a *Ready For QA* cuando el conector vuelva.
