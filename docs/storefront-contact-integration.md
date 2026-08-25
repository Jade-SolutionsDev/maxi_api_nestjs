# Storefront integration — Contact form

How the Next.js storefront consumes the contact vertical.

## Endpoints

| Route | Auth | Purpose |
|---|---|---|
| `GET /api/public/contact/motives` | none | Active motives (`nomenclators`, category `contact-motive`), display order. Cache-Control shared with the taxonomy profile; cache under the `nomenclators` tag — the API pings `/api/revalidate` with it on every nomenclator write. |
| `POST /api/public/contact/messages` | optional bearer | Submit a message. Strict-throttled (6/min per client). |

## Submitting

Body: `{ motiveId, message, name?, lastName?, email?, phone?, website? }`.

- **Signed-in customer**: send the Clerk bearer token (`apiAuth`) and ONLY
  `motiveId` + `message`. The API snapshots the sender identity from the
  customer account and ignores any identity fields in the body. An invalid or
  expired token silently degrades to the anonymous path — send the identity
  fields too if you cannot guarantee token freshness, or just omit the token.
- **Anonymous**: `name`, `lastName` and at least one of `email` / `phone` are
  required (422 otherwise). `message` must be 10–2000 chars. Motive must be an
  active option (400 otherwise).
- **Honeypot**: `website` must exist in the form but stay hidden and empty.
  A non-empty value makes the API answer `201 { received: true }` WITHOUT
  storing anything — never branch UX on it.

Success is always `201 { data: { received: true } }`. Map `429` to a
"try again in a minute" message (strict throttle).

## What the backoffice does with it

Messages land in the admin inbox (permission module `contact`) with status
`nuevo`; agents answer via email/WhatsApp/phone links or — once Resend is
configured (`RESEND_API_KEY` + `RESEND_FROM`) — directly from the platform.
Nothing else is required from the storefront.
