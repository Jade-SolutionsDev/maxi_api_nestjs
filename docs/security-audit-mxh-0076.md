# Security audit MxH-0076 — findings report

Audit base: 2026-08-19 brief (`briefseguridad.md`). This document records **what
was fixed**, **what was deliberately left for later and why**, and the
**operational risks flagged but not owned by this card**. A known, written risk
is a decision; an unwritten one is an oversight.

The real deployment target is **staging**, not production. Several defects stem
from protections gated on `NODE_ENV === 'production'`, which are therefore inert
on staging. `NODE_ENV` also defaults to `'development'` when unset, so a
forgotten variable opens multiple holes at once.

---

## Part 1 — Fixed in this card (branch `fix/security-hardening-mxh-0076`)

Each shipped with a test that fails on `develop` and passes on the branch.

| # | Finding | Fix | Test |
|---|---------|-----|------|
| 1 | `POST /users/storefront-mirror` was an invitation-enumeration **oracle** (403 vs 200) and let an unauthenticated caller **pre-claim** an invited account's storefront password (`skipPasswordChecks: true`). | Endpoint now requires a fresh **backoffice Clerk token whose email matches** the body (`CustomerProvisioningService.tokenOwnsEmail`). Rejections are uniform → invited vs not-invited is indistinguishable, and only the genuine invitee can provision. Dead `InvitationsService.existsByEmail` removed. Frontend attaches the token (repo `maxi_admin_react`, branch `fix/mirror-token`). | `test/storefront-mirror.e2e-spec.ts` — identical response for invited vs stranger; bogus token rejected, nothing provisioned. |
| 2 | Public list `limit` uncapped (`pagination-query.dto.ts`) → `?limit=9999999`. | `@Max(100)` on the DTO **and** a hard clamp in `paginate()` for callers that bypass it. | `paginate.spec.ts` clamp case; `hardening.e2e-spec.ts` asserts 400. |
| 3 | No security headers (`helmet` absent). | `helmet()` in `main.ts` + `test-setup.ts`; strips `X-Powered-By`. | `hardening.e2e-spec.ts` — `x-content-type-options: nosniff`, no `x-powered-by`. |
| 4 | Swagger served on staging (`nodeEnv !== 'production' \|\| SWAGGER_ENABLED`). **Decision: docs are local-development only.** | `shouldExposeDocs(nodeEnv)` → true only for `'development'`; staging/production 404. `SWAGGER_ENABLED` escape hatch removed. | `swagger.util.spec.ts`. |
| 5 | Webhook signature **skipped** when the secret was unset and `nodeEnv !== 'production'` (i.e. on staging) → spoofable admin-user creation. | Unsigned path is now an explicit `ALLOW_UNVERIFIED_WEBHOOKS` opt-in (local/test only); any deployed env without it rejects. | `webhooks-require-secret.e2e-spec.ts` — 401 with no secret and flag unset. |
| 6 | JSON body size implicit (Express default, chosen by nobody). | Explicit `1mb` limit in `main.ts` + `test-setup.ts`; `AllExceptionsFilter` now honors a body-parser error's own status → 413 not 500. | `hardening.e2e-spec.ts` — 2 MB body → 413. |

Also shipped: **global rate limiting** (`@nestjs/throttler`, MxH-0066) — 120/min default, strict 6/min on the mirror route; skipped under `NODE_ENV=test` so e2e stays deterministic.

Verified on a `NODE_ENV=staging` boot: `/api/docs` → 404, secretless webhook → 401, helmet header present, `x-powered-by` absent, `?limit=9999999` → 400, mirror without token → 401, oversized body → 413. Full suite: 246 unit + 29 e2e green.

---

## Part 2 — Deferred (report-only by decision; each is its own card)

Scope for MxH-0076 was fixed at "the six findings only." The sweep confirmed the
following real issues; they are **not fixed here** and need their own cards.

### P0 — do next
- **`MOCK_AUTH_ENABLED` has no production interlock** (`auth.module.ts:34`, `configuration.ts:79`). If the flag is ever true in a deployed env, `Authorization: Bearer mock:<clerkId>` authenticates as **any** user. Recommend: refuse to honor it unless `NODE_ENV` is `development`/`test`, and assert that at startup.

### P1
- **No webhook idempotency.** `svix-id` is never read; no processed-events store. Replays re-run `markAccepted` / admin promotion, and the unsigned local path has no replay window at all. Recommend a `webhook_events(svix_id PK)` insert-or-skip at the top of both handlers.
- **`checkout.dto.ts` unbounded input** (`:12` `deliveryAddress` free-form `@IsObject()`, `:16` `customerNotes` no `@MaxLength`) — attacker-controlled JSON/text from the storefront straight into `orders`.
- **Vulnerable deps** (per `pnpm audit`): **multer < 2.2.0** (in the upload request path, DoS via aborted-upload cleanup) and **typeorm < 1.1.0** (CLI migration-generate injection). Bump `@nestjs/platform-express` + `typeorm`, re-audit.

### P2
- **Cross-instance token confusion** (`clerk-auth.provider.ts:29-55`): verifies storefront-then-backoffice and returns only `{ sub }`; nothing binds a token's issuing instance to its route family. Separation relies on `clerkId` values not colliding between `users` and `clients`. Recommend tagging `VerifiedToken` with the instance and asserting per guard.
- **GROCER sees every customer's data** (`orders.controller.ts:34`): `@Roles(SUPER_ADMIN, ADMIN, GROCER)` with no provider scoping in `findAllAdmin` → a grocer reads every order's `clientEmail` + `deliveryAddress`. Authorization-scope change; deferred deliberately.
- **Missing `ParseUUIDPipe` on 4 public `:id` routes** (`public-products` :89, `public-categories` :56, `public-departments` :57, `geography` :40): a non-UUID → Postgres `22P02` → unauthenticated 500 generator (log-flood vector). The error envelope prevents leakage.

### P3
- **Uncapped arrays**: stock-locations `coverage`/`grocerIds`/`pickupAddresses`, inventory `items`, permissions `set-role-permissions`/`set-user-roles`, cms `legalLinks`.
- **`cms-page.content`** (`cms-page.dto.ts:24,49`): uncapped and **unsanitized**, rendered on the public storefront → stored-XSS surface. Cap + sanitize before render.
- **Public `ProductResponseDto.amount`** leaks real per-product stock levels to competitors; **`PublicCmsController.settings`** returns the raw settings JSON column (whatever an admin writes into it is served). Project both.
- **No 401/403 audit logging** (`all-exceptions.filter.ts`): denied auth/permission attempts leave no trail. Also add a correlation id; the log line currently includes the query string (emails on `?q=`).
- **No startup config validation**: missing secrets degrade silently to insecure defaults (`CLERK_JWT_SECRET` → `'dev-secret'`). Add a schema that fails boot in deployed envs.
- **`PROMOTE_SUPERADMIN_CLERK_ID`** (`main.ts:99`): env-only privilege escalation with only a log line — no audit record.

---

## Part 3 — Operational (not code; flagged, not owned here)

- **Rotate the live Clerk keys.** The untracked `.env` on the audit machine holds real test-instance credentials (`CLERK_SECRET_KEY=sk_test_…`, backoffice secret, backoffice webhook secret). Rotate if the machine is shared or ever imaged. `.env` is correctly gitignored; tracked files are clean.
- **Drop the `'dev-secret'` fallback** for `CLERK_JWT_SECRET` in any deployed env (see P3 config validation).
- **Delete dead `MIBI_KEY_ID` / `MIBI_SECRET_KEY`** from `.env.example` (never read by `configuration.ts`).
- **Parked by the brief itself:** Traefik `api.insecure: true` (infra, panel bound to `127.0.0.1:8080`); CORS is not a server-side control (auth is) — the current origin-less-request allowance is normal, do not "fix" it.
