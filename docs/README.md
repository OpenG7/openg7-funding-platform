# Documentation de la plateforme

Révision documentaire : 19 septembre 2026, après la PR #127 (`137720c`).
L'[état de la plateforme](platform-status.md) distingue les fonctionnalités
livrées, leurs préconditions et les preuves d'exécution disponibles. Une fonction
présente dans le dépôt n'est pas nécessairement activée en production.

## Guides fonctionnels actuels

Pour modifier le dépôt, partir du [socle agent](../AGENTS.md), puis lire seulement
les règles du chemin et du domaine concernés. La [matrice de validation](development/validation.md)
centralise les commandes et leurs garanties; l'[architecture](ARCHITECTURE.md)
se lit en français **ou** en [anglais](ARCHITECTURE.en.md).

Références techniques extraites du README : [configuration](technical/configuration.md),
[API admin](technical/admin-api.md), [API publique](technical/public-api.md) et
[Stripe/webhooks/backfill](technical/stripe.md). Lire la section utile seulement.

| Parcours                                                      | Référence                                                                                                                                     |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Fonds, montants et retour Checkout                            | [Accueil](funding-home.md), [confirmation des paiements](payment-trust-validation.md)                                                         |
| À propos et navigation entre pages                            | [À propos](funding-about.md)                                                                                                                  |
| Totaux, frais, allocations, filtres et exports                | [Transparence](funding-transparency.md)                                                                                                       |
| Annuaire, consentements et médias des commanditaires          | [Commanditaires](public-sponsors.md)                                                                                                          |
| Reconnaissance personnelle, aide et recherche de contribution | [Bâtisseurs et support](public-builders-and-support.md)                                                                                       |
| Suivi privé, récupération et brouillons                       | [Accès et brouillons](sponsorship-access-and-drafts.md)                                                                                       |
| Comptes admin, MFA, rôles, révocation et alertes              | [Accès et alertes](operations/admin-identity-and-alerts.md), [décision d'architecture](decisions/2026-09-19-admin-identity-and-operations.md) |
| Courriels transactionnels et rappels                          | [SMTP](email-smtp.md)                                                                                                                         |

La configuration actuelle des commandites propose 50, 100, 250 et 500 CAD,
avec un minimum de 50 CAD. Les avantages cumulatifs commencent à 50 CAD pour
la mention Web, 250 CAD pour Facebook et 500 CAD pour LinkedIn. Les sources
sont `packages/funding-core/src/index.ts` et la configuration Funding du Web.
Le paiement, le consentement, la revue et la publication restent distincts.

Les pages `/ecosystem`, `/music` et `/boutique` sont des surfaces éditoriales
avec liens externes, disponibles également sous `/en`. La politique publique
se trouve sous `/politique-utilisation-remboursement`. Les routes effectives
sont définies dans `apps/funding-web/src/app/app.routes.ts`; le rendu initial
est décrit dans `app.routes.server.ts` et le statut HTTP dans `nginx.conf`.
Les pages inconnues renvoient HTTP 404, avec textes FR/EN et `noindex`.

Pour renseigner les photos, prix et liens de la sélection NorthDragon, consulter
le [guide des produits vedettes](boutique-products.md).

## Administration

L'entrée est `/admin/login`. Les pages protégées sous `/admin/fundraiser`
couvrent le cockpit, À traiter, l'Assistant, les contributions, commandites,
factures/avoirs, publications, dépenses, transparence, audit, courriels,
configuration et accès/sessions. Les routes sont dans `admin.routes.ts`.

L’[administration des publications](admin-publication-queue.md) propose un accueil
avec carrousel et trois pages distinctes : rédaction et validation, lots de
publication et calendrier éditorial.

Les [lots 1](admin-ux-lot-1.md), [2](admin-ux-lot-2.md),
[3](admin-ux-lot-3.md), [4](admin-ux-lot-4.md), [5](admin-ux-lot-5.md),
[6](admin-ux-lot-6.md) et [7](admin-ux-lot-7.md) décrivent les contrats et
les fonctionnalités livrées à chaque étape; le [lot 8](admin-ux-lot-8.md)
documente leur recette initiale. Les résultats datés de ces lots ne sont pas
les résultats de la révision courante. Les règles OIDC du runbook actuel
complètent les descriptions historiques de connexion par token.

L'Assistant contextuel utilise des règles déterministes. Le volet
conversationnel est optionnel et possède un fournisseur `mock`; aucun
fournisseur IA externe n'est actuellement raccordé à ce volet dans l'API.

La [vue d'ensemble de l'Assistant](admin-assistant-overview.md) propose une
synthèse, des catégories filtrables, des groupes de courriels et un détail avec
retour au contexte, à partir de la file complète et paginée de **À traiter**.

## Exploitation et validation

| Besoin                                          | Référence                                                                              |
| ----------------------------------------------- | -------------------------------------------------------------------------------------- |
| Démarrer et contribuer                          | [README principal](../README.md), [contribution](../CONTRIBUTING.md)                   |
| Frontières et règles de travail                 | [Architecture](ARCHITECTURE.md), [AGENTS.md](../AGENTS.md)                             |
| Déployer selon le périmètre choisi              | [Checklist](production-launch-checklist.md), [Docker/VPS](docker-deployment.md)        |
| Appliquer le schéma et connaître ses limites    | [Migrations PostgreSQL](operations/database-migrations.md)                             |
| Retrouver une commande                          | [Aide-mémoire](command-cheatsheet.md)                                                  |
| Vérifier configuration et services              | [Smoke tests](operations/production-smoke-tests.md)                                    |
| Stocker les médias                              | [Stockage OVH](operations/ovh-object-storage.md)                                       |
| Exercer SMTP, S3, restauration et accessibilité | [Recette contrôlée](operations/integration-rehearsal.md)                               |
| Comprendre la portée des tests                  | [Bilan courant](platform-status.md), [matrice commandite](sponsorship-e2e-coverage.md) |
| Utiliser l'outil VPS optionnel                  | [ProductionLaunchAgent](../apps/production-launch-agent/README.md)                     |

Limite confirmée par lecture du code : les runners de migrations rejouent tous
les fichiers, alors que `019`–`021` créent des tables sans garde de réexécution.
La procédure liée ci-dessus explique pourquoi une recette sur base vide ne
prouve pas la réussite d'un déploiement répété sur une base existante.

## Analyses et bilans historiques

Ces documents conservent les décisions, propositions ou preuves de leur époque.
Leurs formulations « à faire », « non implémenté » ou leurs nombres de tests
ne constituent pas le backlog actuel :

- [Analyse fonctionnelle initiale](fundraiser-functional-analysis.md).
- [Plan initial avec contrainte de budget](openg7-fundraiser-functional-analysis-codex-budget.md).
- [Périmètre MVP](fundraiser-mvp-scope.md) et [bilan MVP](fundraiser-mvp-status.md).
- [Direction UX admin](admin-ux-direction.md) et [plan des huit lots](admin-ux-plan-de-travail.md).
- [Améliorations du suivi, PR #119/#120](sponsorship-followup-improvements.md).
- [Cadrage des contributions externes/La Ruche](external-contributions-laruche-cadrage.md) : proposition toujours distincte d'une fonctionnalité d'import livrée.

## Entretien

Lorsqu'une fonctionnalité change, mettre à jour son guide et les préconditions
d'exploitation dans le même changement. Réserver les preuves datées aux
commandes réellement exécutées et à leur révision. Vérifier les liens locaux,
les scripts de `package.json`, les routes et les noms de variables contre le
code; conserver les secrets hors de la documentation.
