<p align="center">
  <a href="http://nestjs.com/" target="blank"><img src="https://nestjs.com/img/logo-small.svg" width="120" alt="Nest Logo" /></a>
</p>

[circleci-image]: https://img.shields.io/circleci/build/github/nestjs/nest/master?token=abc123def456
[circleci-url]: https://circleci.com/gh/nestjs/nest

  <p align="center">A progressive <a href="http://nodejs.org" target="_blank">Node.js</a> framework for building efficient and scalable server-side applications.</p>
    <p align="center">
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/v/@nestjs/core.svg" alt="NPM Version" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/l/@nestjs/core.svg" alt="Package License" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/dm/@nestjs/common.svg" alt="NPM Downloads" /></a>
<a href="https://circleci.com/gh/nestjs/nest" target="_blank"><img src="https://img.shields.io/circleci/build/github/nestjs/nest/master" alt="CircleCI" /></a>
<a href="https://discord.gg/G7Qnnhy" target="_blank"><img src="https://img.shields.io/badge/discord-online-brightgreen.svg" alt="Discord"/></a>
<a href="https://opencollective.com/nest#backer" target="_blank"><img src="https://opencollective.com/nest/backers/badge.svg" alt="Backers on Open Collective" /></a>
<a href="https://opencollective.com/nest#sponsor" target="_blank"><img src="https://opencollective.com/nest/sponsors/badge.svg" alt="Sponsors on Open Collective" /></a>
  <a href="https://paypal.me/kamilmysliwiec" target="_blank"><img src="https://img.shields.io/badge/Donate-PayPal-ff3f59.svg" alt="Donate us"/></a>
    <a href="https://opencollective.com/nest#sponsor"  target="_blank"><img src="https://img.shields.io/badge/Support%20us-Open%20Collective-41B883.svg" alt="Support us"></a>
  <a href="https://twitter.com/nestframework" target="_blank"><img src="https://img.shields.io/twitter/follow/nestframework.svg?style=social&label=Follow" alt="Follow us on Twitter"></a>
</p>
  <!--[![Backers on Open Collective](https://opencollective.com/nest/backers/badge.svg)](https://opencollective.com/nest#backer)
  [![Sponsors on Open Collective](https://opencollective.com/nest/sponsors/badge.svg)](https://opencollective.com/nest#sponsor)-->

## Description

[Nest](https://github.com/nestjs/nest) framework TypeScript starter repository.

## Project setup

```bash
$ pnpm install
$ cp .env.example .env
```

Start the PostgreSQL container before running the app:

```bash
$ pnpm run docker:db:start
```

Seed the first superadmin user:

```bash
$ pnpm run seed:superadmin
```

## Compile and run the project

```bash
# development
$ pnpm run start

# watch mode
$ pnpm run start:dev

# production mode
$ pnpm run start:prod
```

## Run tests

```bash
# unit tests
$ pnpm run test

# e2e tests
$ pnpm run test:e2e

# test coverage
$ pnpm run test:cov
```

## Database (Docker)

A Docker Compose file is provided for local PostgreSQL 16 development. It creates two databases:
- `maxihabana` — default development database.
- `maxihabana_test` — isolated database for e2e tests.

Copy `.env.example` to `.env` and adjust values if needed:

```bash
$ cp .env.example .env
```

Start the database:

```bash
$ pnpm run docker:db:start
```

Stop the database:

```bash
$ pnpm run docker:db:stop
```

Reset the database (removes all data and volumes):

```bash
$ pnpm run docker:db:reset
```

## Database migrations

**The schema is never inferred from the entities.** `synchronize` is off in every
environment, including development and tests. Every change travels as a committed
migration, and `migrationsRun` applies the pending ones **at boot**, in order.

That is deliberate. `synchronize` silently altered whatever schema it found — and
it can drop columns to make the database match the entities. It is also how
production and development drifted apart before this existed.

### Changing the schema

Edit the entity, then generate the migration by diffing against a database that
is already up to date:

```bash
pnpm run migration:generate src/database/migrations/WhatYouDid
```

Read the generated SQL before committing it. `migration:generate` diffs against
whatever database `DATABASE_URL` points at, so an out-of-date database produces a
wrong migration.

```bash
pnpm run migration:run      # apply pending ones (the app also does this at boot)
pnpm run migration:revert   # undo the last one
```

### The initial migration

`1787500000000-InitialSchema.ts` is the whole schema as of 24-ago-2026, and it is
**idempotent**: `CREATE TABLE IF NOT EXISTS`, plus `DO` blocks for enums and
foreign keys, which do not support it.

That matters because production already had these 31 tables, created by
`synchronize` back when there were no migrations. A plain `CREATE` would fail
there. This way the same migration serves a fresh database and one that already
carries the schema, with no manual step.

**Caveat worth knowing:** `IF NOT EXISTS` skips a table that already exists *even
if its columns differ*. Against a database that has drifted, the migration fails
loudly on the first index over a missing column — which is the useful outcome:
it names exactly what is missing instead of leaving a half-built schema.

Verified end to end: an empty database boots the app, builds all 31 tables and
serves requests; a database that already has the schema applies it without
changing anything.

## Deployment

Everything runs on one VPS under [Dokploy](https://dokploy.com), in the
`maxihabana` project. Six applications across two environments, each with its
own Postgres.

| Application | Repository | Branch | URL |
|---|---|---|---|
| `api` | `maxi_api_nestjs` | `master` | https://api.maxihabana.com |
| `admin` | `maxi_admin_react` | `master` | https://admin.maxihabana.com |
| `storefront` | `maxi_web_client_next` | `main` | https://www.maxihabana.com |
| `api-staging` | `maxi_api_nestjs` | `develop` | https://staging-api.maxihabana.com |
| `admin-staging` | `maxi_admin_react` | `develop` | https://staging-admin.maxihabana.com |
| `storefront-staging` | `maxi_web_client_next` | `development` | https://staging.maxihabana.com |

This API is served under the `/api` prefix (`main.ts`, `setGlobalPrefix`), so
the health check lives at `/api/health` and not at `/health`.

### Merging is deploying

**All six applications have auto-deploy on, triggered by a push to the branch
above.** There is no button to press afterwards and no tag to point Dokploy at:
the moment a pull request lands on `master`, production starts rebuilding by
itself.

This is the one thing to know before approving a pull request against `master`,
and it is invisible from the repository. Merging a pull request into `develop`
likewise redeploys staging within seconds.

Tags (`v1.5.0`, `v1.5.1`, …) are a **record of what was published, not a
trigger**. Pushing a tag deploys nothing.

### Migrations run at boot

`migrationsRun` is on (`app.module.ts`), so **a deployment applies every pending
migration before serving traffic**. Together with auto-deploy that means
merging a migration into `master` runs it against the production database,
unattended, a couple of minutes later.

A migration that cannot be undone deserves a backup taken first. See the
*Database migrations* section above for how they are written.

### Checking that a deployment finished

Dokploy's API answers without `sudo` or `docker`. Credentials live in
`~/.config/maxi/dokploy.env` (`DOKPLOY_URL` already ends in `/api`):

```bash
set -a; . ~/.config/maxi/dokploy.env; set +a
curl -sS -H "x-api-key: $DOKPLOY_API_KEY" \
  "$DOKPLOY_URL/deployment.all?applicationId=5tAPhA8d6nBqVonHNOd0d" \
  | python3 -c "import sys,json; [print(d['status'], d['createdAt'], d['title'][:50]) for d in json.load(sys.stdin)[:3]]"
```

`5tAPhA8d6nBqVonHNOd0d` is production; staging is `vc39dZyZuuYpUwaI6FWYK`. A
deployment moves from `running` to `done`, or to `error` if the build failed.
Whether a failed build leaves the previous container serving has not been
tested here: if a deployment goes red, check the site rather than assume it.

Then check the application itself, which is what actually proves it:

```bash
curl -sS https://api.maxihabana.com/api/health
```

Beware of `application.one`: its response includes the environment variables,
secrets and all. Read the one field you need out of it, never the whole thing.

### Rolling back

Auto-deploy cuts both ways: **revert the commit on `master` and the revert
deploys itself**. That is the path with the fewest moving parts, and the one to
reach for while production is down. Dokploy also keeps earlier deployments and
can redeploy one from its interface — untested here, so do not find out during
an incident.

*Verified on 2026-10-24 against the Dokploy API, the live domains and the
source. `lanzamiento-produccion.md` in the workspace root described a different
flow — pointing Dokploy at a tag — that does not match how the server is
configured.*

## Resources

Check out a few resources that may come in handy when working with NestJS:

- Visit the [NestJS Documentation](https://docs.nestjs.com) to learn more about the framework.
- For questions and support, please visit our [Discord channel](https://discord.gg/G7Qnnhy).
- To dive deeper and get more hands-on experience, check out our official video [courses](https://courses.nestjs.com/).
- Deploy your application to AWS with the help of [NestJS Mau](https://mau.nestjs.com) in just a few clicks.
- Visualize your application graph and interact with the NestJS application in real-time using [NestJS Devtools](https://devtools.nestjs.com).
- Need help with your project (part-time to full-time)? Check out our official [enterprise support](https://enterprise.nestjs.com).
- To stay in the loop and get updates, follow us on [X](https://x.com/nestframework) and [LinkedIn](https://linkedin.com/company/nestjs).
- Looking for a job, or have a job to offer? Check out our official [Jobs board](https://jobs.nestjs.com).

## Support

Nest is an MIT-licensed open source project. It can grow thanks to the sponsors and support by the amazing backers. If you'd like to join them, please [read more here](https://docs.nestjs.com/support).

## Stay in touch

- Author - [Kamil Myśliwiec](https://twitter.com/kammysliwiec)
- Website - [https://nestjs.com](https://nestjs.com/)
- Twitter - [@nestframework](https://twitter.com/nestframework)

## License

Nest is [MIT licensed](https://github.com/nestjs/nest/blob/master/LICENSE).
