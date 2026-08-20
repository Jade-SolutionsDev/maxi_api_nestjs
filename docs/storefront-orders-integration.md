# Storefront Orders — Frontend Integration Guide

Checkout turns the customer's cart into an **order**: prices and product names
are snapshotted at that moment, and the ordered stock is **reserved** — it
immediately stops counting as `available` in the public catalog and in other
customers' carts, while the physical warehouse count only drops when the
back-office confirms the order.

Companion doc: [storefront-cart-integration.md](./storefront-cart-integration.md).
Live schema: Swagger UI at `GET /api/docs` (tag **storefront**).

## Authentication

Same as the cart: every endpoint requires the storefront Clerk token
(`Authorization: Bearer <token>`), and the customer must exist as a `Client`.

## Endpoints

| Method | Path | Body | Purpose |
|---|---|---|---|
| POST | `/api/storefront/orders` | `{ deliveryMunicipalityId?, deliveryAddress?, customerNotes? }` | Checkout the cart |
| GET | `/api/storefront/orders?page&limit` | — | Order history (newest first) |
| GET | `/api/storefront/orders/:id` | — | One order |
| POST | `/api/storefront/orders/:id/cancel` | — | Cancel while `pending` |

### Checkout

```
POST /api/storefront/orders
{
  "deliveryMunicipalityId": "…uuid…",        // optional; defaults to the client's default municipality
  "deliveryAddress": { "street": "…", "…": "…" },  // optional free-form JSON
  "customerNotes": "ring the bell"           // optional
}
```

- The **cart is the input** — there is no items payload. Sync the cart first,
  then check out.
- Prices/names are snapshotted server-side from the cart at this instant;
  the order never changes when the catalog does.
- Stock is reserved atomically. Errors:
  - `400` — cart is empty.
  - `409` — some lines are stale (stock dropped or product deactivated since
    they were carted). `error.details[]` lists each offending product with its
    current `available`. Refresh the cart (GET `/api/cart`), fix the flagged
    lines, retry.
- On success (`201`) the cart is cleared and the order returned.

### Order shape

```json
{
  "data": {
    "id": "…uuid…",
    "orderNumber": "ORD-20260001",
    "status": "pending",
    "paymentStatus": "pending",
    "subtotal": 30, "deliveryFee": 0, "total": 30,
    "deliveryMunicipalityId": "…", "deliveryAddress": { "…": "…" },
    "customerNotes": "ring the bell",
    "items": [
      { "productId": "…", "name": "Cola 1L", "imageUrl": "https://…",
        "quantity": 3, "unitPrice": 10, "lineTotal": 30 }
    ],
    "createdAt": "…", "updatedAt": "…"
  }
}
```

`items[].name`/`unitPrice`/`lineTotal` are checkout-time snapshots;
`imageUrl` is live catalog data (may become `null` if the product is removed).

### Statuses

`status` (fulfillment, moved by the back office):

```
pending → confirmed → processing → shipped → delivered
   └────────┴────────────┴────────────┴──→ cancelled
```

- `pending` — placed, awaiting acceptance. Stock is reserved. **The customer
  can still cancel.**
- `confirmed` — accepted; the reserved stock is physically committed. From
  here on, only the back office can cancel.
- `delivered` / `cancelled` — terminal.

`paymentStatus`: `pending | paid | failed | refunded`. Payments run through
whichever gateways an admin enabled (**Tropipay** hosted card links,
**Mi Billetera** crypto charges): the checkout response includes a `payment`
object whose `kind` says how to render it, and the order becomes `paid` only
when the charge reaches `SUCCEEDED` (webhook or poll). Full contract —
method catalog, rendering, polling cadence, retries — in
[payments-integration.md](./payments-integration.md). With no gateway enabled,
payments fall back to manual back-office settlement.

### Cancel

`POST /api/storefront/orders/:id/cancel` — allowed only while `status` is
`pending`; `409` otherwise (show "contact support"). Cancelling releases the
reservation, so the stock is instantly sellable again.

## Availability semantics (cart + catalog)

Since orders reserve stock, `available` everywhere in the public API
(`/api/public/products`, `/api/cart`) means **physical stock minus active
reservations**. Consequences for the UI:

- A product can sell out purely from pending orders — handle `available: 0` /
  missing from the default catalog list even if "there are boxes in the room".
- A cart line can turn `isAvailable: false` because someone else checked out
  first; checkout will 409 on it (see above).

## cURL smoke test

```bash
TOKEN="<clerk storefront token>"   # or mock:<clerkId> with MOCK_AUTH_ENABLED=true
API=http://localhost:3000/api

curl -s -X POST $API/cart/items -H "Authorization: Bearer $TOKEN" \
     -H 'Content-Type: application/json' -d '{"productId":"<uuid>","quantity":2}'
curl -s -X POST $API/storefront/orders -H "Authorization: Bearer $TOKEN" \
     -H 'Content-Type: application/json' -d '{"customerNotes":"test"}'
curl -s $API/storefront/orders -H "Authorization: Bearer $TOKEN"
curl -s -X POST $API/storefront/orders/<orderId>/cancel -H "Authorization: Bearer $TOKEN"
```
