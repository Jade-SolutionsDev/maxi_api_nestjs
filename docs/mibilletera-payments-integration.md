# Mi Billetera Payments — Frontend Integration Guide

Orders are paid through **Mi Billetera** crypto charges (`CRYPTO` method — the
gateway currently settles USDT on BEP20, but **never hardcode the network**:
render whatever the API returns). The API owns all gateway communication; the
frontend only renders instructions and polls.

Companions: [storefront-orders-integration.md](./storefront-orders-integration.md),
[storefront-cart-integration.md](./storefront-cart-integration.md).
Gateway reference: `/home/dev/work/JADE/docs/Guía de integración MiBilletera.md`.

## The one rule

**An order is paid ONLY when the charge status is `SUCCEEDED`.** Never treat
"the customer saw the deposit address" or "the POST returned 201" as payment.

## Flow

```
checkout ──▶ order.payment (deposit instructions)
                   │  customer sends the exact token amount
                   ▼
        GET /storefront/orders/:id/payment   (poll)
                   │
     ┌─────────────┼──────────────┐
 SUCCEEDED      FAILED      EXPIRED/CANCELLED
 (order paid)  (order failed)  (order still pending
                                → POST .../payment for a new attempt)
```

## Endpoints (client Bearer token, same auth as the rest of the storefront)

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/storefront/orders` | Checkout. Response now includes `payment` when the gateway is configured |
| GET | `/api/storefront/orders/:id/payment` | Current attempt, refreshed from the gateway while non-terminal. 404 if no attempt exists yet |
| POST | `/api/storefront/orders/:id/payment` | Start/restart an attempt (after `EXPIRED`/`FAILED`/`CANCELLED`, or when checkout-time creation failed). Returns the live attempt if one exists; 400 if already paid |

### `payment` shape

```json
{
  "provider": "mibilletera",
  "reference": "MCH8F2A4C7E1B0D9A3C",
  "status": "REQUIRES_ACTION",
  "depositAddress": "0x2Ff4A8a7f3F2b1cD9e7F6a5B4C3D2E1F0A987654",
  "amount": "30.00000000",
  "token": "usdt",
  "blockchain": "BEP20",
  "expiresAt": "2026-07-30T15:42:15.781Z",
  "feeAmount": "0.75000000",
  "settlementAmount": "29.25000000",
  "errorMessage": null,
  "createdAt": "2026-07-30T15:37:15.781Z"
}
```

Charge statuses: `PENDING | REQUIRES_ACTION | PROCESSING | SUCCEEDED | FAILED |
EXPIRED | CANCELLED` (last four are terminal).

## Rendering the payment screen

Show, verbatim from the response (all of it comes from the gateway's
`action_payload`):

> Envía **exactamente `{amount}` `{token}` en `{blockchain}`** a:
> `{depositAddress}`

- The **exact amount** matters — over/under-payment may not settle.
- The **network** (`blockchain`) must be visible; funds sent on another
  network are lost.
- Show a countdown to `expiresAt` and hide/disable the instructions when it
  passes. Expired instructions must never be reused — offer "generar nuevo
  intento" (`POST .../payment`) instead.

## Polling cadence (gateway-official)

| Situation | Poll `GET .../payment` every |
|---|---|
| Payment screen visible | 5–10 s |
| Customer navigated away, order still unpaid | 30–60 s until `expiresAt` |
| After `expiresAt` | Stop client-side polling |

On `SUCCEEDED` → show success; the order's `paymentStatus` is now `paid`.
On `FAILED` → show `errorMessage` + retry button.
On `EXPIRED`/`CANCELLED` → offer a new attempt (the order stays `pending`).

Webhooks settle most orders server-side before your next poll — polling is the
fallback, not the primary signal, so don't panic-refresh.

## Fallbacks & edge cases

- **`payment` missing from the checkout response** — either the gateway is not
  configured for this environment (manual payments: admin settles from the
  back office) or charge creation failed transiently. Call
  `POST .../payment`; a 4xx/5xx there means "try again later" UI.
- **409/400 on `POST .../payment`** — order already paid, or a live attempt
  exists (the live attempt is returned; just render it).
- **Late settlement**: a charge can move `EXPIRED → SUCCEEDED` if the funds
  arrive late with the right amount. If a customer claims they paid an expired
  charge, tell them to contact support with the `reference`.

## Environment / configuration (backend, for reference)

```bash
MIBI_KEY_ID=mb_key_...          # merchant API key (scopes: charges write+read)
MIBI_SECRET_KEY=mb_secret_...
MIBI_WEBHOOK_SECRET=...         # HMAC secret for POST /api/webhooks/mibilletera
MIBI_API_BASE=https://mibilletera.cu   # point at https://dev.mibilletera.cu for staging
```

Gateway disabled (keys unset) → orders fall back to manual payments; every
storefront payment endpoint 404s on GET (no attempt) and the admin marks
payments by hand. The webhook URL to register with Mi Billetera:
`https://<api-host>/api/webhooks/mibilletera`.

## Storefront implementation (feat/payments-mibilletera in maxi_web_client_next)

The full customer journey is implemented: cart → `/checkout` (delivery form +
summary, municipality from the `maxi_location` cookie) → `POST
/storefront/orders` → `/pedidos/[id]` with the **PaymentPanel**, which renders
the deposit instructions strictly from the API's `payment` object
(address + exact amount + token + network + countdown to `expiresAt`), polls
`GET /storefront/orders/:id/payment` every 8s while visible, offers
"Reintentar pago" after FAILED/EXPIRED/CANCELLED, and degrades to a
"pago pendiente de confirmación manual" state when the gateway is not
configured or unreachable. Order history lives at `/pedidos`.

## Local end-to-end simulation (no gateway needed)

1. Run the API with `MOCK_AUTH_ENABLED=true`, empty `MIBI_KEY_ID`/`MIBI_SECRET_KEY`
   (forces the manual provider — no real charges) and `MIBI_WEBHOOK_SECRET=whsec_sim`.
2. Checkout normally (storefront or `mock:<clerkId>` token). The order lands
   `pending/pending` with no charge.
3. Insert a fake charge for the order:
   `INSERT INTO payment_charges (order_id, reference, idempotency_key, status,
   amount, currency, action_payload, expires_at) VALUES ('<orderId>', 'MCHSIM001',
   'order_<n>_crypto_1', 'REQUIRES_ACTION', '13.00000000', 'USD',
   '{"deposit_address":"0x…","amount":"13.00000000","token":"usdt",
   "blockchain":"BEP20"}', now() + interval '5 minutes');`
   → the storefront panel now shows the instructions.
4. Fire a signed webhook:
   body `{"event":"charge.succeeded","reference":"MCHSIM001","status":"SUCCEEDED",
   "net_amount":"12.67000000", ...}`, header `X-Mibi-Signature` =
   HMAC-SHA256(whsec_sim, raw body) hex → order flips to `paid`, panel shows
   success, admin order detail shows the gateway card with settlement figures.

## Sandbox status (2026-08-13)

`https://dev.mibilletera.cu/` (sandbox per miBilletera support) does not answer
from our network — connection times out before TLS (the user's browser got a
403, suggesting an IP allowlist or WAF). When access is granted, point
`MIBI_API_BASE=https://dev.mibilletera.cu` and re-run the happy path for real.
