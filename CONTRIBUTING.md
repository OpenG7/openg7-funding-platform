# Contributing

## Prerequisites

- Node.js 22.x
- Yarn 4.9.4 (`corepack enable`)

## Setup

```bash
yarn install
```

## Quality commands

```bash
yarn lint
yarn format:check
yarn test
yarn build
yarn docs
```

Use French (`fr-CA`) as default locale for user-facing content and keep all user-facing strings in translation files.

Use the [documentation index](docs/README.md) to find current feature contracts
and operational guides. Update those guides when routes, environment variables,
permissions, migrations or visible behavior change. Historical lot reports keep
their dated validation results; current evidence belongs in
[platform status](docs/platform-status.md).

`yarn build` compiles TypeScript; build the Web separately with
`yarn workspace @openg7/funding-web build --configuration production`.
Browser and disposable integration checks, including their Docker images and
browser prerequisites, are listed in the platform status document. The global
format check currently reports existing differences; do not mix an unrelated
repository-wide formatting rewrite into a functional change.
