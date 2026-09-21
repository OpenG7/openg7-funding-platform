# Contributing

## Prerequisites

- Node.js 22.x
- Yarn 4.9.4 (`corepack enable`)

## Setup

```bash
yarn install
```

## Validation

Use the [validation matrix](docs/development/validation.md) to select the required
checks for the change. It distinguishes TypeScript compilation, Angular builds,
Node tests, browser fixtures and disposable integration tests, and records their
prerequisites. `yarn test` already compiles TypeScript.

Use French (`fr-CA`) as default locale for user-facing content and keep all user-facing strings in translation files.

Use the [documentation index](docs/README.md) to find current feature contracts
and operational guides. Update those guides when routes, environment variables,
permissions, migrations or visible behavior change. Historical lot reports keep
their dated validation results; current evidence belongs in
[platform status](docs/platform-status.md).

For documentation/instruction maintenance, run `node scripts/check-agent-docs.mjs`.
See [documentation ownership and budgets](docs/development/documentation.md).
Keep checks and formatting scoped as described in the matrix; report existing
failures separately from regressions introduced by the change.
