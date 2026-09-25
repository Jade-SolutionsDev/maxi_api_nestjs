# Admin → Storefront Mirror

Backoffice users and storefront customers live in **two separate Clerk applications**
(`CLERK_BACKOFFICE_SECRET_KEY` and `CLERK_SECRET_KEY`) so that the two audiences never collide.
The side effect is that a staff member who wants to shop would have to register from scratch.

This feature removes that friction: when an invited admin accepts their invitation, a matching
**storefront customer is created with the same email and password**. It stays disabled until an
admin approves the invitee, and is removed if they are rejected.

Companion docs: [storefront-cart-integration.md](./storefront-cart-integration.md) ·
[storefront-orders-integration.md](./storefront-orders-integration.md).

## The flow

| Step | Where | What happens |
|---|---|---|
| 1. Sign-up | `useInvitationFlow` (admin SPA) | After the backoffice account exists, the page POSTs `{email, password, …}` to `POST /api/users/storefront-mirror`. **This is the only moment the plaintext password is available.** Best-effort: a failure never blocks the pending screen. |
| 2. Gate | `StorefrontMirrorController` | Rejects with `403` unless an invitation exists for that email (`InvitationsService.existsByEmail`). |
| 3. Provision | `CustomerProvisioningService.provisionPending` | Creates the storefront Clerk user (`users.createUser` with `skipPasswordChecks`) and writes a **disabled** `Client` (`isActive=false`, `adminInvitePending=true`). |
| 4. Approve | `UsersService.update`, first activation | `activateForEmail` flips the `Client` to active. |
| 5. Reject | `UsersService.remove`, never-approved user | `revokeForEmail` deletes both the Clerk user and the `Client`. |

Steps 4 and 5 run through `safeMirror`, so a storefront hiccup never blocks the admin action.
A user who was approved and later deleted **keeps** their customer account.

## Why a separate controller

`UsersController` is `@Roles(...)`-gated, and a `@Public()` route inside it would still be
rejected by `RolesGuard`. `StorefrontMirrorController` exists solely to host one public route.

## Guarantees

- **The password is never persisted.** It is forwarded to Clerk and discarded.
- **A pre-existing real customer is never touched.** `adminInvitePending` marks the rows this
  feature owns, so approve/reject can never modify a genuine customer that happens to share the
  address.
- **A pending mirror cannot shop.** `ClientAuthService` rejects `deletedAt || !isActive`, so the
  mirror is inert until approved.

## Known gaps

**1. The new column has no migration.** `clients.admin_invite_pending` is created by TypeORM
`synchronize`, which `app.module.ts` enables only when `NODE_ENV !== 'production'`. There is no
migration system in the repo, so **in production the column will not exist**. This blocks a
production deploy of this feature, and it is not specific to it — `users.approved_at` has the same
problem.

**2. The public endpoint is an invitation oracle.** It answers `403` for an address with no
invitation and `200` for one that has it, so anyone can probe addresses and learn **which emails
have been invited to the backoffice** — that is, who works in administration. It grants no access,
but it does leak staff addresses. There is no rate limiting anywhere in the API yet, so probing is
cheap. Hardening options: return the same response either way, require a token tied to the
invitation, or at minimum rate-limit the route.
