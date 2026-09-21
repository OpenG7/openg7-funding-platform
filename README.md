# OpenG7 Funding Platform

![OpenG7 — Le Fonds des Bâtisseurs](docs/images/openg7-fonds-des-batisseurs-banner.png)

Reusable, transparent and configurable funding engine for OpenG7 ecosystem projects.
See [platform status](docs/platform-status.md) for delivered features and dated
execution evidence, and the [documentation index](docs/README.md) for current guides.
Historical MVP/lot reports describe earlier revisions, not the current backlog.

## Quick start

Use Node.js 22 and Yarn 4.9.4. From the repository root:

```sh
corepack enable
yarn install
```

Copy [.env.example](.env.example) to an ignored `.env`, configure the required
local services, then run `yarn dev`. See the
[configuration reference](docs/technical/configuration.md) for service variables,
Stripe-direct startup and optional PostgreSQL. Mock Checkout is local-only;
production without Stripe configuration returns an error.

Stripe-direct provides Checkout and aggregate transparency without PostgreSQL.
Persistent admin, sponsor follow-up, directories, OIDC and alert episodes need
the private database. Before `yarn db:migrate`, read the
[migration procedure and replay limitation](docs/operations/database-migrations.md).

## Workspaces and reuse

| Workspace                      | Purpose                                                    |
| ------------------------------ | ---------------------------------------------------------- |
| `apps/funding-web`             | Angular public/admin UI and SSR                            |
| `apps/funding-api`             | Node API, Stripe, persistence, media and workers           |
| `apps/production-launch-agent` | Optional controlled VPS tooling                            |
| `packages/funding-core`        | Framework-independent funding rules and Checkout contracts |
| `packages/funding-models`      | Immutable domain models                                    |
| `packages/funding-ui`          | Shared design tokens and primitives                        |
| `packages/funding-i18n`        | Translation keys and locale metadata                       |

Reuse the `@openg7/funding-*` packages with project-specific configuration through
the funding config provider. The OpenG7 example is in
[openg7-funding.config.ts](apps/funding-web/src/app/features/funding/config/openg7-funding.config.ts).
Use signals for local presentation and NgRx only for durable shared data; see
[Web instructions](apps/funding-web/AGENTS.md) and [architecture](docs/ARCHITECTURE.md).

## Development and validation

| Need                                                            | Reference                                                         |
| --------------------------------------------------------------- | ----------------------------------------------------------------- |
| Commands, Docker updates and troubleshooting                    | [Command cheatsheet](docs/command-cheatsheet.md)                  |
| TypeScript/Angular builds, Node/browser tests and prerequisites | [Validation matrix](docs/development/validation.md)               |
| Contribution workflow                                           | [CONTRIBUTING](CONTRIBUTING.md), [agent instructions](AGENTS.md)  |
| Controlled SMTP/S3/restore rehearsal                            | [Integration rehearsal](docs/operations/integration-rehearsal.md) |
| Local trusted HTTPS and renewal                                 | [Local HTTPS](docs/docker-deployment.md#https-local-de-confiance) |

`yarn test` includes TypeScript compilation; Angular has its own workspace build.
Browser fixtures, disposable API/DB tests and real provider checks establish
different guarantees. Production activation is not proven by a local test.

## API and operations references

Read the relevant reference rather than every guide:

- [Configuration and startup](docs/technical/configuration.md): environment, database and setup.
- [Admin API](docs/technical/admin-api.md): sessions, protected endpoints, sponsorship review and accounting.
- [Public API](docs/technical/public-api.md): directories, follow-up, policy, transparency and routing.
- [Stripe webhooks and backfill](docs/technical/stripe.md): events, local CLI, resend and bounded imports.
- [Publication automation](docs/operations/publication-automation.md) and [administrative controls](docs/operations/admin-pilotage.md).
- [Production checklist](docs/production-launch-checklist.md) and [Docker/VPS deployment](docs/docker-deployment.md).

Deployment, production migrations, live payments, refunds and external sending
require explicit operational authorization. Configuration examples contain no
production credentials. License: MIT.
