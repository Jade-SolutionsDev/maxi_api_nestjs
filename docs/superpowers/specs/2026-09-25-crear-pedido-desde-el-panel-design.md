# Crear un pedido en nombre de un cliente, desde el panel

**Fecha:** 25 de septiembre de 2026
**Estado:** diseño aprobado por Jade, pendiente de plan de implementación
**Repos que toca:** `maxi_api_nestjs`, `maxi_admin_react`

---

## Por qué

Hay clientes que compran por WhatsApp o por teléfono y no pasan por la tienda.
Hoy no hay forma de registrar esa venta: el pedido solo nace del `checkout` de
la tienda, y el `checkout` exige una sesión de cliente y un carrito suyo.

Nace de la revisión del 24 de septiembre de «Crear clientes en el módulo
cliente», donde se separaron dos necesidades que estaban confundidas en una
sola tarjeta:

- **Dar de alta al cliente** — resuelto ese mismo día con el botón «Invitar
  cliente» (`maxi_api_nestjs#17`, `maxi_web_client_next#47`, `maxi_admin_react#16`).
- **Hacerle el pedido tú** — este documento.

## Lo que ya existe y no hay que escribir

Comprobado en el código el 25 de septiembre:

| Pieza | Dónde | Qué aporta |
|---|---|---|
| `OrdersService.checkout()` | `src/orders/orders.service.ts:219` | Reserva, totales, entrega, plazo, evento de creación, todo en una transacción |
| `FulfillmentService.resolveChoice()` | `src/fulfillment/` | Valida entrega o recogida contra la zona y devuelve el plazo comprometido |
| `ProductsService.availableForArea()` | `src/products/` | Disponibilidad de una lista de productos en un municipio. Es lo que usa el carrito |
| `OrdersService.updateItems()` | `src/orders/orders.service.ts:1353` | Cambia las líneas de un pedido moviendo el almacén según su fase. Acepta precio a mano |
| `OrderItemsEditor.tsx` | `maxi_admin_react/src/pages/orders/` | 556 líneas: selector de productos con stock, cantidades, precios, avisos |
| `order_events` | `src/order-events/` | Ya distingue `actorUserId` de `actorClientId` |
| `orders:update-payment-status` | `src/permissions/permissions.service.ts:91` | El permiso de cobrar a mano ya existe y ya se usa |
| `sellarCobro()` | `src/orders/payment-sealing.ts:13` | Fija `paidAt` y calcula `promisedAt` desde el plazo |
| `paymentReceived()` | `src/mail/templates.ts:332` | Correo de «hemos recibido tu pago» |

De las cuatro decisiones que planteaba la tarjeta, **dos ya las responde el
código**: el rastro del empleado (lo da `order_events`) y el permiso de cobro
(ya existe). No hay que inventarlos.

## Decisiones tomadas

Las tres que quedaban, decididas por Jade el 25 de septiembre:

1. **El pedido siempre cuelga de un cliente con cuenta.** `order.clientId` es
   obligatorio en la tabla y no se toca. Si quien llama no tiene cuenta, el
   propio formulario lo invita —reutilizando el alta de clientes de ayer— y
   sigue con el `clientId` recién creado. El pedido puede existir antes de que
   el cliente ponga su contraseña; eso vale.
2. **La reserva caduca igual que cualquier otra**: 30 minutos por pasarela, 24
   horas en pago manual. Cero código: el pedido queda idéntico a uno de la
   tienda y lo barre el mismo proceso de siempre.
3. **Se puede marcar como cobrado al crearlo**, para cuando ya se cobró por
   fuera. Con condiciones, abajo.

## Arquitectura

### El núcleo compartido

`checkout()` hace hoy dos trabajos pegados:

1. **Resolver qué se pide** — lee el carrito del cliente, lo valora, comprueba
   disponibilidad.
2. **Crear el pedido** — cabecera, reservas, líneas, evento, en una transacción.

El panel necesita el segundo sin el primero: un empleado no puede usar el
carrito del cliente, porque `checkout()` lo vacía al terminar y le borraría lo
que ese cliente tuviera dentro.

Se extrae un método privado `crearPedido(params)` con el trabajo 2. Recibe las
líneas **ya valoradas** (producto, nombre, precio unitario, cantidad) y no sabe
de dónde salieron. **No toca carritos y no manda correos**: eso lo decide cada
llamador.

```
checkout(client, dto)                  crearParaCliente(user, dto)
  ├─ leer y valorar el carrito           ├─ valorar las líneas del DTO
  ├─ crearPedido(...)  ◄────────────────────────┘  (mismo núcleo)
  ├─ vaciar el carrito                   ├─ (sin carrito que vaciar)
  ├─ lanzar la pasarela                  ├─ (sin pasarela: ver abajo)
  └─ correo «tenemos tu pedido»          └─ correo, según haya cobro o no
```

**Por qué el panel no lanza la pasarela:** un intento de pago es una sesión de
cobro a nombre del comprador. Un empleado no puede iniciarla por él. El cliente
la inicia desde la página de su pedido, que es lo que ya hace hoy cuando un
checkout falla al crear el intento.

### Valorar las líneas del panel

No es código nuevo: `ProductsService.availableForArea(ids, área)` es
exactamente lo que usa el carrito para saber qué hay disponible en el municipio
del cliente. El precio sale del catálogo, salvo que el panel mande uno a mano
—igual que ya admite `updateItems()`, y por la misma razón: una venta acordada
por teléfono puede llevar un precio pactado.

### El cobro, dentro de la misma transacción

Si el pedido nace ya cobrado, el cambio de estado de pago va **dentro de la
transacción que lo crea**, no en una segunda llamada.

**Por qué importa:** entre crear el pedido y marcarlo pagado habría un hueco en
el que el pedido está pendiente. El barrido de caducidad puede pasar por ahí y
cancelarlo, soltando el stock de una venta que ya está cobrada.

Dentro de esa transacción: `paymentStatus = PAID`, `sellarCobro(order)` —que
fija `paidAt` y calcula `promisedAt` desde el plazo congelado— y un evento
`PAYMENT_STATUS_CHANGED` propio, separado del de creación.

Exige **los dos permisos**: `orders:create` y `orders:update-payment-status`.
Quien solo pueda crear, crea pendiente.

### Permiso nuevo

`orders:create`, añadido a `MODULE_ACTIONS.orders`. Separado de
`update-status` a propósito: crear un pedido en nombre de otro mueve stock e
inventa deuda, que no es lo mismo que avanzar uno que ya existe. No se concede
a nadie por defecto; se otorga por rol como cualquier otro.

### El historial

Sin cambios de esquema. El evento `CREATED` se graba con
`actor: { userId }` en vez de `{ clientId }`, y `meta.canal: 'back-office'`.
El historial del pedido dirá quién lo creó y por dónde.

### Qué correo sale

El correo `orderReceived` dice literalmente *«Todavía falta el pago»* y enseña
un botón de «Pagar mi pedido». En un pedido que nace cobrado eso es falso.

Por eso el correo se elige según el caso, y no hay que tocar ninguna plantilla:

- Pedido pendiente → `orderReceived`, igual que la tienda.
- Pedido ya cobrado → `paymentReceived`, que ya existe y dice lo correcto.

## El panel

**Entrada:** botón «Crear pedido» en el listado, visible solo con
`orders:create`.

**Formulario**, en este orden:

1. **Cliente** — autocompletado sobre los clientes existentes, con un «no está:
   invitarlo» que abre el alta de ayer sin salir de la pantalla.
2. **Líneas** — el selector de productos con stock que hoy vive dentro de
   `OrderItemsEditor.tsx`, **extraído a un componente compartido**. Lo usan los
   dos: el editor de líneas de un pedido existente y este formulario.
3. **Entrega** — a domicilio o recogida, con las mismas opciones y tarifas que
   ve el cliente en su municipio.
4. **Pago** — método, y la casilla «ya cobrado» con su referencia. La casilla
   solo se enseña a quien tenga el permiso de cobros.
5. **Notas.**

**Por qué extraer el selector y no copiarlo:** si se copia, en unos meses habrá
dos selectores que discrepan en qué stock enseñan. Es el mismo riesgo que ya se
materializó con el reporte de pedidos (MxH-0120): se resolvió sacando el
constructor de filtros de `findAllAdmin` a `aplicarFiltros` (`orders.service.ts:565`),
compartido por listado y reporte.

## Errores

- Cliente inexistente o borrado → 404, antes de tocar nada.
- Pedido sin líneas → 400.
- Producto inactivo o sin stock suficiente en la zona → 409 con el detalle por
  línea, con la **misma forma** que devuelve el checkout de la tienda.
- Opción de entrega que no cubre el municipio → 400.
- Marcar cobrado sin `orders:update-payment-status` → 403, y el pedido **no se
  crea**: la comprobación va antes de abrir la transacción.
- Fallo al mandar el correo → se registra y no tumba nada; el pedido ya existe.

## Pruebas

La prueba que justifica todo el diseño: **crear el mismo pedido por los dos
caminos y comprobar que salen idénticos** en stock reservado, totales,
plazo congelado y correos enviados. Es lo único que impide que la tienda y el
panel se separen con el tiempo.

Además:

- El carrito del cliente **no se toca** al crearle un pedido desde el panel.
- Un pedido creado sin cobro caduca con el barrido de siempre.
- Un pedido creado con cobro **no** caduca, y tiene `paidAt` y `promisedAt`.
- Crear con cobro sin el permiso de cobros → 403 y cero filas escritas.
- El evento de creación guarda el usuario, no el cliente.
- Pedido pendiente manda `orderReceived`; pedido cobrado manda `paymentReceived`.

## Fuera de alcance

- **Editar el pedido tras crearlo** — ya existe (`updateItems`, `updateStatus`).
- **Cobrar por pasarela desde el panel** — el cliente paga desde su pedido.
- **Descuentos o precios negociados como concepto** — el precio a mano por línea
  ya cubre el caso real; un sistema de descuentos es otra tarjeta.
- **Pedidos sin cliente** — descartado arriba, decisión 1.
- **Catálogo por almacén distinto del que ve el cliente** — el panel enseña el
  stock del municipio del cliente, igual que la tienda.

## Riesgo principal

Que se escriba un `checkout` paralelo «porque es más rápido». El diseño entero
existe para evitarlo: un solo núcleo que crea pedidos, y una prueba que compara
los dos caminos.
