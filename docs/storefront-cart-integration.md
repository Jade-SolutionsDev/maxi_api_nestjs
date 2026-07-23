# Storefront Cart — Frontend Integration Guide

The cart is **account-bound and server-persisted**: it is keyed to the
authenticated Clerk customer, so the same cart appears on every device the
customer signs into. All prices are **calculated server-side on every
response** — the frontend must never compute or cache prices.

Live schema: Swagger UI at `GET /api/docs` (tag **storefront**).

## Authentication

Every cart endpoint requires a **storefront Clerk token**:

```
Authorization: Bearer <clerk session token>
```

- Get the token from Clerk on the client (`getToken()` from `useAuth()` /
  `auth()` in Next.js).
- The customer must already exist as a `Client` in the API (created by the
  storefront `user.created` webhook on sign-up). Unknown or deactivated
  accounts get `401` (`Client not registered` / `Account is inactive`).
- No token → `401`. There is **no guest cart server-side** (see
  [Guest carts](#guest-carts-and-sign-in-merge)).

## Response envelopes

Success responses are wrapped as `{ "data": ... }`; errors as:

```json
{ "error": { "code": "ConflictException", "message": "...", "details": [ ... ] } }
```

## Endpoints

| Method | Path | Body | Purpose |
|---|---|---|---|
| GET | `/api/cart` | — | Fetch the cart |
| POST | `/api/cart/items` | `{ productId, quantity }` | Add (increments existing line) |
| PATCH | `/api/cart/items/:productId` | `{ quantity }` | Set absolute line quantity (≥ 1) |
| DELETE | `/api/cart/items/:productId` | — | Remove a line |
| DELETE | `/api/cart` | — | Clear the cart |

**Every mutation returns the full recalculated cart** — the same shape as
`GET /api/cart`. Replace your local cart state with it; you never need a
follow-up GET.

### Cart shape

```json
{
  "data": {
    "items": [
      {
        "productId": "0a4e…",
        "name": "Cola 1L",
        "slug": "cola-1l",
        "imageUrl": "https://…",
        "format": "Botella 1 L",
        "measureUnit": "unidad",
        "quantity": 3,
        "unitPrice": 7.5,
        "lineTotal": 22.5,
        "available": 5,
        "isAvailable": true
      }
    ],
    "totalItems": 3,
    "subtotal": 22.5
  }
}
```

- `unitPrice` — the product's current discounted price (`finalPrice` in the
  catalog endpoints), recomputed from the live catalog on every read.
- `lineTotal` = `unitPrice × quantity`; `subtotal` = sum of line totals.
  No taxes/shipping yet.
- `available` — current total stock across all storages.
- `isAvailable: false` — the product was deactivated/removed from the catalog
  or stock dropped below the cart quantity. The API **reports** this but never
  silently changes the customer's cart. UI should flag the line and offer
  "reduce to `available`" (PATCH) or "remove" (DELETE).

### Adding a product

```
POST /api/cart/items
{ "productId": "0a4e…", "quantity": 1 }
```

- The classic "Add to cart" button: posting the same product again
  **increments** the line (`2 + 1 → 3`).
- The product must be an **active catalog product**; inactive/unknown → `404`.
- The **resulting** line quantity must not exceed `available`.

### Setting a quantity (cart page steppers)

```
PATCH /api/cart/items/:productId
{ "quantity": 4 }
```

- Absolute overwrite; `quantity` must be ≥ 1 — use DELETE to remove the line.
- Line must already exist → otherwise `404`.

### Insufficient stock → 409

POST and PATCH validate against current stock. On violation:

```json
{
  "error": {
    "code": "ConflictException",
    "message": "Insufficient stock: only 5 available",
    "details": [
      { "field": "quantity", "message": "Only 5 available", "available": 5 }
    ]
  }
}
```

Use `error.details[0].available` (machine-readable) to clamp the quantity
stepper and show "only N left" — don't parse the message.

## Integration rules

1. **Never compute prices client-side.** Render `unitPrice`, `lineTotal`, and
   `subtotal` straight from the response. If you show a price on the product
   page, it may differ from the cart if an admin changed it in between — the
   cart response is the truth.
2. **Use each mutation's response as the new cart state.** One round-trip per
   action; no refetch.
3. **Refetch the cart on page load / focus** (e.g. SWR/React Query with
   `revalidateOnFocus`): prices and stock can change server-side at any time,
   and the customer may have edited the cart on another device.
4. **Handle `isAvailable: false` lines before checkout UX**: the API keeps
   them in the cart so the customer decides; orders will reject them later.
5. Send quantities as **integers ≥ 1** — validation errors come back as `400`
   with `error.details[]` messages.

## Guest carts and sign-in merge

The API only stores carts for authenticated customers. If the storefront
offers a guest cart, keep it in `localStorage` and on sign-in merge it by
looping `POST /api/cart/items` for each stored line (POST increments, so
merging with an existing server cart is additive), then clear the local copy.
A 409 during the merge means the combined quantity exceeds stock — fall back
to `PATCH` with `details[0].available` or drop the line.

## cURL smoke test

```bash
TOKEN="<clerk storefront token>"
API=http://localhost:3000/api

curl -s $API/cart -H "Authorization: Bearer $TOKEN"
curl -s -X POST $API/cart/items -H "Authorization: Bearer $TOKEN" \
     -H 'Content-Type: application/json' \
     -d '{"productId":"<uuid>","quantity":1}'
curl -s -X PATCH $API/cart/items/<uuid> -H "Authorization: Bearer $TOKEN" \
     -H 'Content-Type: application/json' -d '{"quantity":3}'
curl -s -X DELETE $API/cart/items/<uuid> -H "Authorization: Bearer $TOKEN"
curl -s -X DELETE $API/cart -H "Authorization: Bearer $TOKEN"
```

Local dev tip: with `MOCK_AUTH_ENABLED=true` on the API, `TOKEN="mock:<clerkId>"`
authenticates as the `Client` with that `clerkId` — no Clerk needed.
