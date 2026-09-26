# Validation selon le changement

Consulter uniquement les lignes pertinentes; les exigences métier des guides liés
complètent cette matrice. Les scripts de [package.json](../../package.json) font
foi. Utiliser Node 22 et Yarn 4; ne pas changer le lockfile sans nécessité.

## Matrice minimale

| Changement                                           | Vérifications                                                                                                                                    |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Documentation                                        | `git diff --check`, format ciblé, liens/ancres et `node scripts/check-project-standards.mjs` et `node scripts/check-agent-docs.mjs`              |
| UI/style                                             | Format, `yarn lint`, build Angular, tests d'états/interactions pertinents, SSR, i18n, clavier/focus et responsive                                |
| Configuration ou package                             | Compilation et tests de configuration/domaine; consommateurs concernés                                                                           |
| API                                                  | Format, `yarn lint`, `yarn test`; contrats, erreurs et chemins de reprise                                                                        |
| Stripe/webhook, comptabilité, courriel, transparence | [Scénarios financiers](financial-rules.md#scenarios) applicables, tests unitaires/intégration                                                    |
| Commandite, média, publication                       | [Scénarios commandites](sponsorship-rules.md#validation), permissions, consentement, états, audit et reprises                                    |
| Admin                                                | Session valide/expirée/absente, endpoint protégé, confirmation sensible, secrets absents, rôle, audit, CSV privé; OIDC/MFA/révocation si touchés |
| Migration                                            | Base locale propre et existante, contraintes et tests API; lire la [limite du runner](../operations/database-migrations.md) avant exécution      |
| Docker/Traefik                                       | `docker compose config --quiet`, santé ciblée, délais/dépendances, aucun secret imprimé                                                          |
| Scripts/VPS                                          | Analyse statique et syntaxe shell, tests locaux ciblés; aucune opération de production implicite                                                 |

Ajouter les tests adaptés avec le changement fonctionnel. Préserver signature,
répétition, ordre, données fournisseur partielles, reprise après échec et double
soumission admin lorsque le domaine les expose. Une modification purement
documentaire n'exige pas de lancer les suites applicatives.

## Portée des commandes

| Commande                                                                  | Ce qu'elle vérifie                                                                                                                                  |
| ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `yarn build`                                                              | Compilation TypeScript via `tsconfig.build.json`; pas le build Angular                                                                              |
| `yarn test`                                                               | Compilation TypeScript puis tests Node; ne pas refaire `yarn build` juste avant                                                                     |
| `yarn workspace @openg7/funding-web build --configuration production`     | Build Angular et rendu initial/SSR configuré                                                                                                        |
| `yarn test:e2e`                                                           | Suite Node de couverture commandite; aucun navigateur                                                                                               |
| `yarn test:e2e:acceptance`                                                | API/DB/navigateur en pile Docker jetable, fournisseurs simulés                                                                                      |
| `yarn test:e2e:identity`                                                  | API réelle, Web compilé, PostgreSQL jetable et fournisseur OIDC signé local; rôles et révocation                                                    |
| `yarn test:e2e:playwright`                                                | Démarrage/réutilisation Docker local, migrations et seed, puis Playwright; modifie l'état local                                                     |
| `yarn test:ui:admin`                                                      | UI admin sur build Angular avec fixtures/interceptions                                                                                              |
| `yarn test:ui:public-journeys`                                            | Parcours publics FR/EN sur plusieurs navigateurs avec API interceptées                                                                              |
| `yarn test:ui:platform-accessibility`                                     | Accessibilité, routes 404 et chargement différé                                                                                                     |
| `yarn test:integration:payments`                                          | Compilation puis intégrations jetables sous `tests/integration/`                                                                                    |
| `yarn test:rehearsal`                                                     | Recette jetable des adaptateurs, SMTP/S3 et restauration                                                                                            |
| `yarn test:automation`                                                    | Tests Node, build Angular production, alertes/S3 jetables, restauration applicative et parcours navigateur publics/accessibilité; aucun secret réel |
| `yarn exec playwright test --config tests/playwright-recovery.config.mjs` | Scripts de sauvegarde/restauration et récupération applicative sur cibles jetables                                                                  |

Prérequis et preuves datées : [état de la plateforme](../platform-status.md),
[recette fournisseurs](../operations/integration-rehearsal.md),
[couverture commandite](../sponsorship-e2e-coverage.md). Choisir la suite UI du
parcours touché dans `package.json`; ne pas exécuter toutes les suites par réflexe.
Les contrôles navigateur demandent leurs binaires; les intégrations Docker leurs
images. Un test simulé, un conteneur sain et une qualification externe sont des
preuves différentes.

## Format et compte rendu

`yarn format:check` vérifie tout le dépôt et peut signaler des écarts préexistants.
Vérifier les fichiers du changement avec Prettier; ne pas reformater le reste du
dépôt pour faire passer une tâche ciblée. La commande `yarn lint` reste globale.

Relire le diff complet du changement; exécuter `git diff --check` et
`git status --short`. Rapporter commandes réellement exécutées et résultats,
omissions motivées, risques, migrations/manipulations nécessaires. Séparer valeur
visible pour l'utilisateur et garanties d'exécution. Ne pas réattribuer les preuves
historiques à une nouvelle révision. Une fois les contrôles requis réussis, ne les
répéter qu'en cas de changement, échec ou doute restant.
