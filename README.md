# OpenG7 Funding Platform

Reusable, transparent and configurable funding engine for OpenG7 ecosystem projects.

## Workspace architecture

- `apps/funding-web`: Angular standalone funding experience.
- `packages/funding-core`: reusable funding domain logic and checkout contract.
- `packages/funding-ui`: reusable design tokens.
- `packages/funding-models`: immutable funding models.
- `packages/funding-i18n`: shared translation keys and locale metadata.

## Signal-first approach

Use Angular `signal()`, `computed()` and `effect()` for local visual/UI state (selection, panel toggles, local loading, animation state). Keep component state local and reactive.

## NgRx guidance

Use NgRx only for shared and persistent funding data:

- confirmed contribution totals
- shared campaign information
- allocation data
- contributor records
- backend synchronization state

Do **not** use NgRx for purely visual state.

## Reuse in other projects

Install and import workspace packages:

- `@openg7/funding-models`
- `@openg7/funding-core`
- `@openg7/funding-ui`
- `@openg7/funding-i18n`

Provide project-specific configuration with the funding config provider.

## OpenG7 example configuration

`apps/funding-web/src/app/features/funding/config/openg7-funding.config.ts` ships with:

- Project: OpenG7
- Campaign: Le Fonds des Bâtisseurs
- Currency: CAD
- Locale: fr-CA
- Monthly goal: 270
- Contribution amounts: 5, 10, 25, 50

## Commands

```bash
corepack enable
yarn install
yarn lint
yarn format
yarn format:check
yarn test
yarn build
yarn docs
```
