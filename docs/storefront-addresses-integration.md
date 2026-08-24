# Storefront Addresses — Frontend Integration Guide

Saved delivery addresses belong to the **authenticated customer** and to nobody else. Every route
is scoped by the Clerk session, and an address that belongs to another customer answers **404, not
403** — the API must never confirm that somebody else's address exists. Do not build anything that
relies on telling those two cases apart.

The **province is never sent and never stored**. An address carries a `municipalityId`; the API
resolves the province from the geography catalog and returns both names ready to print. Ask for the
province in the form if it helps the customer narrow down the municipality, but do not send it.

> **The checkout does not consume this yet.** Offering saved addresses at payment time, preselecting
> the default one, and adding an address without leaving the cart are the second half of `MxH-0054`
> and are not implemented. This guide covers only the account screen.

## Authentication

Same as the cart and orders: `Authorization: Bearer <clerk-session-token>`. No token, or a token
that is not a valid customer session, is `401`.

## The shape

```jsonc
{
  "id": "0f2c...",
  "label": "Casa",                    // null when unnamed
  "street": "Calle 23 #456",
  "betweenStreets": "entre 8 y 10",   // null when empty
  "reference": "Edificio azul",       // null when empty
  "municipalityId": "9a1d...",
  "municipalityName": "Plaza de la Revolución",
  "provinceId": "3b7e...",            // derived, not stored
  "provinceName": "La Habana",
  "contactPhone": "55512345",         // null -> call the customer's own phone
  "isDefault": true,
  "createdAt": "2026-08-24T13:30:00.000Z"
}
```

`municipalityName` and `provinceName` come back as empty strings if the municipality ever leaves the
catalog. The address stays readable instead of the whole list failing — render it, do not assume
those fields are always populated.

## Endpoints

All under `/api/storefront/addresses`.

| Method | Path | Answers |
|---|---|---|
| `GET` | `/` | The customer's addresses. **Default first, then newest.** |
| `GET` | `/{id}` | One address. `404` if it is not this customer's. |
| `POST` | `/` | The created address. `409` when the cap is reached. |
| `PATCH` | `/{id}` | The updated address. **Does not change the default.** |
| `PATCH` | `/{id}/default` | The promoted address. |
| `DELETE` | `/{id}` | `204`. Soft delete. |

### Creating

```jsonc
POST /api/storefront/addresses
{
  "street": "Calle 23 #456",     // required
  "municipalityId": "9a1d...",   // required, must exist in the catalog
  "label": "Casa",               // optional
  "betweenStreets": "entre 8 y 10",
  "reference": "Edificio azul",
  "contactPhone": "55512345"
}
```

**The first address a customer saves is always the default**, whatever `isDefault` says. A customer
with addresses but no default has no answer at checkout, so the API refuses to allow that state.

A `municipalityId` that is not in the catalog is `404`, not `400` — it is a missing catalog row, and
it is reported the same way the geography endpoints report one.

### Editing

`PATCH` accepts the same fields, all optional. Two things worth knowing:

- **Sending an optional field as `""` clears it.** The column ends up `null` rather than holding a
  blank that pretends to be a value. Omitting the field leaves it untouched.
- **`isDefault` is ignored here.** Promoting an address is `PATCH /{id}/default`, so the
  one-default-per-customer rule lives in exactly one place.

### Deleting

Soft delete. **If the deleted address was the default, the newest surviving address is promoted
automatically** — no second call needed. Deleting the last one promotes nobody.

## What deleting or editing does NOT do

**Orders already placed keep their own copy of the address.** `Order.deliveryAddress` is a snapshot
taken at checkout; editing or deleting a saved address afterwards does not rewrite history. Never
render a past order's delivery address by looking up the saved address by id — it may be gone, or
it may say something else now.

## Limits and errors

| Status | When |
|---|---|
| `400` | Body failed validation (missing `street`, malformed `municipalityId`, field too long). |
| `401` | No session, or not a valid customer session. |
| `404` | No such address **for this customer**, or the municipality is not in the catalog. |
| `409` | The customer already has 20 saved addresses. |

Twenty is the per-customer cap. It is deliberate and cheap to raise; surface it as a real message
("Has llegado al máximo de 20 direcciones guardadas"), not as a generic failure.
