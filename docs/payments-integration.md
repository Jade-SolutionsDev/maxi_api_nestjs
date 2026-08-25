# Payments — Integration Guide

Orders can be paid through several gateways. The API owns every gateway
conversation and normalizes the result, so **clients branch on `payment.kind`,
never on the provider name**:

| `kind` | Gateway today | What the client renders |
|---|---|---|
| `redirect` | **Tropipay** (cards) | A "pay now" button pointing at `redirectUrl` |
| `instructions` | **Mi Billetera** (crypto) | The deposit data from the response, verbatim |
| `manual` | fallback | "we'll confirm your payment by hand" |

Adding a gateway does not change this contract — an existing screen picks it up.

Companions: [storefront-orders-integration.md](./storefront-orders-integration.md),
[storefront-cart-integration.md](./storefront-cart-integration.md).
Gateway references: `/home/dev/work/JADE/docs/Guía de integración MiBilletera.md`,
`/home/dev/work/JADE/Tropipay DOC.md`.

## The one rule

**An order is paid ONLY when the charge status is `SUCCEEDED`.** Never treat
"the customer saw the deposit address", "the customer was redirected to the
gateway" or "the POST returned 201" as payment. For hosted-redirect gateways
this is not pedantry: the customer can pay and close the tab, so the signed
webhook — not the return page — is what settles the order.

## Flow

```
GET /storefront/payment-methods ──▶ customer picks one at checkout
                   │
POST /storefront/orders {paymentMethod} ──▶ order.payment
                   │           redirect: send them to payment.redirectUrl
                   │           instructions: render the deposit data
                   ▼
        GET /storefront/orders/:id/payment   (poll)
                   │
     ┌─────────────┼──────────────┐
 SUCCEEDED      FAILED      EXPIRED/CANCELLED
 (order paid)  (order failed)  (order still pending
                                → POST .../payment for a new attempt)
```

## Which methods are on

An admin enables gateways in the back office (`payment_methods` table). A
gateway whose credentials are absent from the environment reports
`configured: false` and **cannot** be enabled, so a customer is never offered a
method that would fail. `manual` is always available as the floor.

## Endpoints (client Bearer token, same auth as the rest of the storefront)

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/storefront/payment-methods` | Methods the customer may pick, in display order. Render a picker only when there is more than one |
| POST | `/api/storefront/orders` | Checkout. Optional `paymentMethod` (code); response includes `payment` when a gateway is enabled |
| GET | `/api/storefront/orders/:id/payment` | Current attempt, refreshed from the gateway while non-terminal. 404 if no attempt exists yet |
| POST | `/api/storefront/orders/:id/payment` | Start/restart an attempt (after `EXPIRED`/`FAILED`/`CANCELLED`, or when checkout-time creation failed). Optional body `{ "method": "tropipay" }`. Returns the live attempt when it uses the same method; passing a different method starts a fresh one; 400 if already paid |

Admin: `GET /api/payment-methods` and `PATCH /api/payment-methods/:id`
(`SUPER_ADMIN`/`ADMIN`) drive the catalog — `enabled`, label, description,
icon, sort order and non-secret `config`. Credentials are never editable there.

### `payment` shape

One shape for every gateway; the fields another gateway doesn't use are null.

```json
{
  "provider": "mibilletera",
  "kind": "instructions",
  "reference": "MCH8F2A4C7E1B0D9A3C",
  "status": "REQUIRES_ACTION",
  "redirectUrl": null,
  "depositAddress": "0x2Ff4A8a7f3F2b1cD9e7F6a5B4C3D2E1F0A987654",
  "amount": "30.00000000",
  "token": "usdt",
  "blockchain": "BEP20",
  "currency": "USD",
  "expiresAt": "2026-07-30T15:42:15.781Z",
  "feeAmount": "0.75000000",
  "settlementAmount": "29.25000000",
  "errorMessage": null,
  "createdAt": "2026-07-30T15:37:15.781Z"
}
```

```json
{
  "provider": "tropipay",
  "kind": "redirect",
  "reference": "order_ORD-20260001_tropipay_1",
  "status": "REQUIRES_ACTION",
  "redirectUrl": "https://tppay.me/lmumoe35",
  "depositAddress": null,
  "amount": "38.00",
  "token": null,
  "blockchain": null,
  "currency": "USD",
  "expiresAt": null,
  "feeAmount": null,
  "settlementAmount": null,
  "errorMessage": null,
  "createdAt": "2026-08-20T15:37:15.781Z"
}
```

Charge statuses: `PENDING | REQUIRES_ACTION | PROCESSING | SUCCEEDED | FAILED |
EXPIRED | CANCELLED` (last four are terminal).

## Rendering the payment screen

### `kind: "redirect"` (Tropipay)

Send the customer to `redirectUrl` — a full-page navigation, not an iframe.
`expiresAt` is null, so there is no countdown. Keep polling while the tab is
open: the customer may pay in another tab, or come back before the webhook.

Two rules the redirect shape imposes:

- **Create the link exactly once.** Every attempt is a real, billable payment
  card at the gateway. The attempt is created server-side and persisted, so
  re-render freely — but never initiate from an effect that can fire twice.
- **The return page must not sit behind a cross-site-strict auth gate.** The
  return from Tropipay is a cross-site navigation; a `SameSite=Strict` session
  cookie is withheld on that hop and a logged-in customer gets bounced to
  login. Clerk's cookie is `Lax`, which is fine.

### `kind: "instructions"` (Mi Billetera)

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

- **`payment` missing from the checkout response** — either no gateway is
  enabled for this environment (manual payments: admin settles from the back
  office) or charge creation failed transiently. Call `POST .../payment`; a
  4xx/5xx there means "try again later" UI.
- **409/400 on `POST .../payment`** — order already paid, or a live attempt
  exists (the live attempt is returned; just render it).
- **Late settlement**: a charge can move `EXPIRED → SUCCEEDED` if the funds
  arrive late with the right amount. If a customer claims they paid an expired
  charge, tell them to contact support with the `reference`.

## Environment / configuration (backend, for reference)

```bash
MIBI_KEY_ID=mb_key_...          # store API key (dev store keys differ from production)
MIBI_SECRET_KEY=mb_secret_...
MIBI_WEBHOOK_SECRET=...         # HMAC secret for POST /api/webhooks/payments/mibilletera
MIBI_API_BASE=https://mibilletera.cu   # point at https://dev.mibilletera.cu for staging
MIBI_CURRENCY=USD               # settlement currency of the charge (default USD)
MIBI_METHOD=CRYPTO              # CRYPTO or WALLET, per the store's provisioning
```

Gateway unconfigured (keys unset) → it cannot be enabled, and with no gateway
enabled orders fall back to manual payments: the admin marks them by hand. The
webhook URL to register with Mi Billetera:
`https://<api-host>/api/webhooks/payments/mibilletera`.

**`MIBI_CURRENCY` must match a receiving account bound to the merchant payment
account at Mi Billetera.** If it doesn't, charge creation fails with
`No active receiving account is bound for currency '<X>'` (HTTP 400) — the
order is still created (payment stays pending, retry available). Fix by asking
Mi Billetera ops to bind a receiving account for that currency, or by setting
`MIBI_CURRENCY` to a currency the account already supports. The binding is
also **method-scoped**: a store whose account serves WALLET can still reject
CRYPTO charges with the same message — `scripts/mibi-diagnose.sh` (run from a
network that reaches the gateway) fires the store panel's own example with
both methods to tell the two cases apart, and `MIBI_METHOD` selects the
provisioned one without a rebuild.

**Webhook contract (confirmed against the dev store panel, 2026-08-24):**
POST JSON, `X-Mibi-Signature` = lowercase hex HMAC-SHA256 of the exact body
bytes — no prefix, **no timestamp** (the exported doc's "validate timestamp"
does not apply). Any 2xx acknowledges. Delivery is not guaranteed and events
repeat — processing is deduplicated by reference + terminal status, and
polling stays the authoritative reconciliation. Terminal events:
`charge.succeeded|failed|expired|cancelled`; the parser derives the status
from the event name if the payload omits a `status` field. Local dev without
a public URL needs no webhook at all: the storefront's polling settles the
order on its own.

## Network reality (verified 2026-08-13)

`mibilletera.cu` only accepts connections from **Cuban IPs** — from abroad the
TCP connection times out. Mi Billetera support is allowlisting the production
server IP. Local testing against the real gateway therefore requires a Cuban
connection (no VPN).

## Tropipay specifics

```bash
TROPIPAY_CLIENT_ID=...          # App credential (client id / secret)
TROPIPAY_CLIENT_SECRET=...
TROPIPAY_ENV=Development        # Development = tropipay-dev.herokuapp.com sandbox
TROPIPAY_CURRENCY=USD           # EUR or USD ONLY
PUBLIC_API_URL=https://...      # public base for urlNotification (a tunnel locally)
```

Webhook to register / receive: `POST {PUBLIC_API_URL}/api/webhooks/payments/tropipay`
— it is set per payment link as `urlNotification`, so nothing has to be
configured in Tropipay's dashboard.

Things the API already handles, listed because they are easy to re-break:

- **Amounts are minor units.** `amount: 3800` is 38.00. So are `data.amount`,
  `data.originalCurrencyAmount` and `ourFee` on the notification.
- **Only EUR and USD** are accepted; anything else 400s with a message that
  does not name the currency (`error.details` is the only place the rejected
  field appears — the API logs it).
- **Bare `localhost` is rejected** in callback URLs; `127.0.0.1` and plain
  `http` are fine. Callback URLs are normalized accordingly. But 127.0.0.1 only
  passes *validation* — Tropipay still cannot reach your machine, so
  `PUBLIC_API_URL` needs a real tunnel (`cloudflared tunnel --url
  http://localhost:3000`) for the webhook to arrive. `urlSuccess`/`urlFailed`
  can stay local, since the customer's browser is what follows them.
- **Signature**: `sha256(bankOrderCode + clientId + clientSecret +
  originalCurrencyAmount)`, sent as `signaturev2`. Verified before anything in
  the body is trusted. `status: "OK"` = paid, `"KO"` = attempted and failed.
- **Movements lag the webhook.** `syncCharge` scans recent movements for our
  reference and can only ever *promote* a charge to SUCCEEDED; terminal charges
  are never re-polled.
- **Refunds cannot be automated in production**: `refundMovement` needs an SMS
  2FA code sent to the account holder. Refunds stay a manual admin action
  (`PATCH /orders/:id/payment-status`).

## Storefront implementation (feat/payments-tropipay in maxi_web_client_next)

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
   (unconfigured → cannot be enabled, so no real charges) and
   `MIBI_WEBHOOK_SECRET=whsec_sim`.
2. Checkout normally (storefront or `mock:<clerkId>` token). The order lands
   `pending/pending` with no charge.
3. Insert a fake charge for the order:
   `INSERT INTO payment_charges (order_id, provider, reference, idempotency_key,
   status, amount, currency, action_payload, expires_at) VALUES ('<orderId>',
   'mibilletera', 'MCHSIM001',
   'order_<n>_mibilletera_1', 'REQUIRES_ACTION', '13.00000000', 'USD',
   '{"deposit_address":"0x…","amount":"13.00000000","token":"usdt",
   "blockchain":"BEP20"}', now() + interval '5 minutes');`
   → the storefront panel now shows the instructions.
4. Fire a signed webhook:
   body `{"event":"charge.succeeded","reference":"MCHSIM001","status":"SUCCEEDED",
   "net_amount":"12.67000000", ...}`, header `X-Mibi-Signature` =
   HMAC-SHA256(whsec_sim, raw body) hex, posted to
   `/api/webhooks/payments/mibilletera` → order flips to `paid`, panel shows
   success, admin order detail shows the gateway card with settlement figures.

## Sandbox status (2026-08-13)

`https://dev.mibilletera.cu/` (sandbox per miBilletera support) does not answer
from our network — connection times out before TLS (the user's browser got a
403, suggesting an IP allowlist or WAF). When access is granted, point
`MIBI_API_BASE=https://dev.mibilletera.cu` and re-run the happy path for real.
