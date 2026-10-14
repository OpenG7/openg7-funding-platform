# Validation selon le changement

Consulter uniquement les lignes pertinentes; les exigences métier des guides liés
complètent cette matrice. Les scripts de [package.json](../../package.json) font
foi. Utiliser Node 22 et Yarn 4; ne pas changer le lockfile sans nécessité.

## Matrice minimale

<!-- prettier-ignore -->
| Changement | Vérifications |
| --- | --- |
| Documentation | `git diff --check`, format ciblé et `yarn docs:check` (standards, budgets et liens/ancres) |
| UI/style | Format, `yarn lint`, build Angular, tests d'états/interactions pertinents, SSR, i18n, clavier/focus et responsive |
| Configuration ou package | Compilation et tests de configuration/domaine; consommateurs concernés |
| API | Format, `yarn lint`, `yarn test`; contrats, erreurs et chemins de reprise |
| Stripe/webhook, comptabilité, courriel, transparence | [Scénarios financiers](financial-rules.md#scenarios) applicables, tests unitaires/intégration |
| Commandite, média, publication | [Scénarios commandites](sponsorship-rules.md#validation), permissions, consentement, états, audit et reprises |
| Admin | Session valide/expirée/absente, endpoint protégé, confirmation sensible, secrets absents, rôle, audit, CSV privé; OIDC/MFA/révocation si touchés |
| Migration | Base locale propre et existante, contraintes et tests API; lire la [limite du runner](../operations/database-migrations.md) avant exécution |
| Docker/Traefik | `docker compose config --quiet`, santé ciblée, délais/dépendances, aucun secret imprimé |
| Scripts/VPS | Analyse statique et syntaxe shell, tests locaux ciblés; aucune opération de production implicite |

Ajouter les tests adaptés avec le changement fonctionnel. Préserver signature,
répétition, ordre, données fournisseur partielles, reprise après échec et double
soumission admin lorsque le domaine les expose. Une modification purement
documentaire n'exige pas de lancer les suites applicatives.

## Portée des commandes

<!-- prettier-ignore -->
| Commande | Ce qu'elle vérifie |
| --- | --- |
| `yarn build` | Compilation TypeScript via `tsconfig.build.json`; pas le build Angular |
| `yarn docs:check` | Standards OpenG7 puis budgets UTF-8, liens/ancres et scripts documentés ; lecture seule |
| `yarn docs:report` | Rapport JSON du contrôle documentaire, dont les chaînes de consignes et leurs budgets |
| `yarn keycloak:check` | Préflight de configuration Keycloak ; aucun service démarré ni qualification OIDC/MFA |
| `yarn keycloak:reset-password --dry-run` | Plan de réinitialisation d'une personne du realm local `openg7`, sans changer de mot de passe ; l'exécution interactive exige confirmation de cible et saisies masquées, avec révocation OpenG7 séparée |
| `yarn keycloak:provision-user --dry-run` | Configuration sans réseau/écriture ; [contrats et tests](../operations/keycloak-provisioning.md) |
| `node scripts/prepare-local-identity.mjs` | Vérifie le profil local et ses certificats, génère les fichiers Traefik et l'import utilisateur initial si configuré ; aucun service ou compte créé |
| `yarn test` | Compilation TypeScript puis tests Node; ne pas refaire `yarn build` juste avant |
| `yarn workspace @openg7/funding-web build --configuration production` | Build Angular et rendu initial/SSR configuré |
| `yarn test:sponsorship` | Suite Node de couverture commandite; aucun navigateur |
| `yarn test:e2e:acceptance` | API/DB/navigateur en pile Docker jetable, fournisseurs simulés; lanceur hôte Node.js `>=22`, images et CI sous Node 22 |
| `yarn test:e2e:selection` | Découverte des suites CI et specs Playwright; aucun navigateur ou service lancé |
| `yarn test:e2e:identity` | API réelle, Web compilé, PostgreSQL jetable et fournisseur OIDC signé local; rôles et révocation |
| `node --test tests/identity/keycloak-identity.integration.mjs` | Keycloak réel, OTP, droits et sessions API/DB jetables; image locale requise |
| `node --test tests/identity/keycloak-local-https.integration.mjs` | HTTPS local opt-in : provisionnement/répétition, OTP, API/Web et deux DB jetables ; images préconstruites et CA approuvée requises |
| `node --test tests/identity/keycloak-initial-user.integration.mjs` | Avec `FUNDING_KEYCLOAK_INITIAL_USER_TEST=1`, import initial réel et conservation après redémarrage sur Keycloak/PostgreSQL jetables ; HTTPS/CA synthétiques, images locales et OpenSSL requis, sans port publié |
| `yarn test:e2e:playwright` | Démarrage/réutilisation Docker local, migrations et seed, puis Playwright; modifie l'état local |
| `yarn test:ui:admin` | UI admin sur build Angular avec fixtures/interceptions |
| `yarn test:ui:public-journeys` | Parcours publics FR/EN sur plusieurs navigateurs avec API interceptées |
| `yarn test:ui:platform-accessibility` | Accessibilité, routes 404 et chargement différé |
| `yarn test:integration` | Compilation puis intégrations jetables sous `tests/integration/` |
| `yarn test:rehearsal` | Recette jetable des adaptateurs, SMTP/S3 et restauration |
| `yarn test:automation` | Tests Node, build Angular production, alertes/S3 jetables, restauration applicative et parcours navigateur publics/accessibilité; aucun secret réel |
| `yarn exec playwright test --config tests/playwright-recovery.config.mjs` | Scripts de sauvegarde/restauration et récupération applicative sur cibles jetables |

[Admin acceptance](../../.github/workflows/admin-acceptance.yml) répartit Docker
et l'UI admin en quatre groupes chacun; commandites, public, accessibilité,
identité et récupération ont leurs runners isolés. Docker garde un worker et
un seed complet par pile. Artefacts distincts; tous les groupes, intégrations
et Keycloak doivent réussir.

En recette Docker, N0 porte sur le contenu persisté avant publication. Le refus
N4 attend une seconde identité OIDC signée locale; l'auteur ne peut pas le
confirmer. L'API OIDC partage base et médias jetables avec l'API token, sans
worker supplémentaire. Web et fournisseur ont des ports loopback distincts;
aucun fournisseur externe ni `.env` n'est utilisé.

Le [passage à heure contrôlée](../../tests/playwright/support/acceptance-publication-worker.ts)
du service API jetable vérifie échéance et rejeu. Le résultat incertain est aussi
vérifié au vrai timer après redémarrage. La recette courriel conserve les backoffs,
puis avance l'éligibilité de son seul message synthétique. Les cadences de
production sont inchangées.

`keycloak:check` exige Compose pour un fichier d'environnement, sans contacter daemon ou fournisseur.
Les [vérifications DNS/HTTPS et OIDC/MFA](../operations/keycloak-vps.md) restent
distinctes. La CI couvre identité et import initial sur Keycloak jetable; la
[recette HTTPS locale](../operations/keycloak-local.md#recette-https-jetable-reproductible)
exige une CA déjà approuvée et reste séparée. Aucun test local ne qualifie la production.

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
