# Consolidation de l'application

Travail local du 5 octobre 2026 sur `feat/keycloak-vps-identity`, après les
corrections Docker/Keycloak. Cette passe consolide des règles répétées dans l'API,
le Web et le cœur partagé, à comportement constant. Les modifications Docker
déjà présentes restent décrites dans le [runbook identité](../operations/keycloak-vps.md).

## Propriétaires et consommateurs

| Responsabilité                                                              | Propriétaire                                                                                                                      | Consommateurs                                                                         |
| --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Reconnaître le media type JSON exact                                        | [http-routing.ts](../../apps/funding-api/src/http-routing.ts)                                                                     | Neuf gardes dans sept adaptateurs HTTP                                                |
| Normaliser une référence publique `OG7`                                     | [public-reference.ts](../../packages/funding-core/src/public-reference.ts), export public du cœur                                 | Module API existant par réexport et formulaire de support Web                         |
| Classer les éléments administratifs par priorité, échéance puis identifiant | [admin-work-queue.ts](../../packages/funding-core/src/admin-work-queue.ts), export public du cœur                                 | Projection de la file et read model de pilotage ; réexport API des priorités conservé |
| Afficher les horodatages du cockpit                                         | [admin-cockpit-date-time.ts](../../apps/funding-web/src/app/features/funding/components/admin-cockpit/admin-cockpit-date-time.ts) | Activité, métriques, systèmes, statut Stripe et cartes système                        |

Les packages n'importent aucun fichier applicatif et ces fonctions n'ont pas
d'effet externe. L'API utilise le barrel public relatif du cœur pour ses imports
runtime ESM, conformément à l'arborescence émise par la compilation du monorepo.
Les chemins d'import API existants restent utilisables par les réexports.

## Comportements conservés

- HTTP : paramètres MIME, espaces et casse sont traités comme auparavant.
  Les routes ayant une politique différente conservent leur propre validation ;
  les statuts, messages et l'ordre des contrôles d'accès restent inchangés.
- Référence publique : trim, majuscules et expression régulière existante,
  sans nouvelle restriction d'année ni exposition de données privées.
  Le formulaire conserve ses états et erreurs ; le serveur valide la référence.
- File et pilotage : priorité avant échéance, éléments sans échéance après les
  éléments datés, puis identifiant pour départager les égalités. La déduplication,
  les filtres, la pagination et les droits restent dans leurs consommateurs.
  Le tri de l'Assistant qui utilise la date de détection reste distinct.
- Cockpit : langue courante à chaque appel, fuseau `America/Toronto`, date et
  heure courtes. Une date invalide conserve son erreur ; aucun cache ni nouveau
  fallback. Les méthodes des composants, templates et hooks UI sont conservés.

## Vérification

La [matrice de validation](validation.md) définit les contrôles applicables.
Les tests dédiés portent sur les MIME, les références valides/invalides, l'ordre
de la file et les horodatages FR/EN autour des changements d'heure à Toronto.
Les recettes navigateur ciblées utilisent le Web compilé, un serveur local et
des réponses API synthétiques interceptées, sans charger `.env` ni démarrer l'API.

```sh
yarn test
yarn lint
yarn workspace @openg7/funding-web build --configuration production
yarn exec tsc -p tests/tsconfig.admin-ui.json
yarn exec playwright test --config tests/playwright-admin-ui.config.mjs admin-cockpit.spec.ts admin-setup-layout.spec.ts
yarn exec playwright test --config tests/playwright-public-journeys.config.mjs support-page.spec.ts --project chromium --grep 'support lookup validates'
```

Le format ciblé, les standards OpenG7 et `git diff --check` complètent ces
contrôles. Cette préparation locale ne qualifie aucun environnement de production.

Résultats de cette passe sous Node 22.23.3 :

- `yarn test` : 5 530 réussites, un test ignoré, aucun échec.
- Build Angular production : réussi, 24 routes statiques prérendues.
- Vérification TypeScript UI : réussie ; 30 tests cockpit/configuration admin
  et deux tests support FR/EN réussis sur le Web compilé.
- `yarn lint` : aucune erreur ; un avertissement préexistant dans
  `scripts/smoke-public.mjs`.
- Format ciblé, standard OpenG7 et `git diff --check` réussis.
- Le contrôle des budgets documentaires a échoué localement sous Windows sur
  des fichiers en CRLF. Les blobs Git en LF respectent les plafonds :
  `docs/technical/admin-api.md` compte 15 342 octets sur 15 360,
  `docs/technical/stripe.md` 8 186 sur 8 192. Le job **Agent documentation**
  de la PR #284 a réussi dans le
  [run 37384858970](https://github.com/OpenG7/openg7-funding-platform/actions/runs/37384858970).
  Le [guide de documentation](documentation.md) précise
  la règle LF.

Ces résultats restent des preuves de la passe initiale. Les prochaines révisions
exigent une nouvelle exécution des contrôles applicables selon la matrice.

Le complément documentaire du 5 octobre 2026 ajoute les raccourcis
`docs:check`, `docs:report` et `keycloak:check`, et impose LF aux fichiers Markdown.
`yarn docs:check` et `yarn docs:report` réussissent localement : 19 budgets et
255 liens/ancres vérifiés, aucun échec. Le format ciblé et `git diff --check`
passent également ; les suites applicatives restent celles de la passe initiale.

Les recettes navigateur restent limitées aux fixtures interceptées ; aucun
fournisseur réel, compte de production, déploiement ou migration n'a été utilisé.
