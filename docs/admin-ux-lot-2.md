# Lot 2 — À traiter et première version du cockpit

Terminé le 16 septembre 2026, selon le [plan de travail](./admin-ux-plan-de-travail.md), les [requis](./admin-ux-direction.md) et la [maquette](./images/admin-ui.png).

## Résultat visible

- Nouvelle destination **À traiter** : `/admin/fundraiser/attention`.
- File paginée côté serveur, filtrable par type, priorité et échéance. Les filtres et la page figurent dans l’URL et sont conservés au retour d’un dossier ou après connexion.
- Bloc **À traiter aujourd’hui** dans le tableau de bord : quatre interventions prioritaires, compteur global du jour et accès à la sélection complète. Ce bloc se charge indépendamment des indicateurs financiers.
- Liens vers le dossier exact de commandite, le courriel, la facturation, le brouillon, le lot ou le créneau. Les publications ciblées reçoivent le focus. Un événement Stripe possède une URL d’alerte affichant son identifiant, son type, son état de traitement et sa date de réception, sans son payload privé.
- Génération d’une facture manquante limitée au dossier choisi, après confirmation explicite. Elle réutilise le backfill existant, sans envoi de courriel, et consigne le dossier dans son audit.
- Traductions FR/EN, états de chargement, absence de résultat, alerte résolue, indisponibilité, échec d’actualisation et accès refusé. Les données précédentes conservées après un échec sont explicitement signalées comme potentiellement périmées.

Les tâches sont des projections des états métier. Il n’existe ni table parallèle de tâches ni action « terminer » indépendante de la résolution réelle. Le retour à la file et l’actualisation relisent le serveur; aucune mutation ne résulte de l’ouverture d’une alerte. Une mutation échouée ne résout pas artificiellement sa tâche.

## Règles de détection et de priorité

Les détecteurs existants de [l’Assistant](../apps/funding-api/src/admin-assistant/attention.service.ts) restent la source des alertes de commandite, de préparation, de courriel et de litige. Le nouveau [service de file](../apps/funding-api/src/admin-work-queue.service.ts) les compose avec les cas supplémentaires.

| Type                      | Condition et priorité                                                                                                                                                                               |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fiche à compléter         | Commandite payée, sans remboursement en cours, avec fiche incomplète. Cette semaine avant 2 jours; aujourd’hui à partir de 2 jours; urgent à partir de 7 jours depuis le paiement.                  |
| Commandite à réviser      | Fiche complète, paiement confirmé, revue en attente et aucun remboursement en cours. Cette semaine avant 3 jours; aujourd’hui à partir de 3 jours; urgent à partir de 7 jours depuis la soumission. |
| Publication à préparer    | Engagement social d’une commandite approuvée sans brouillon actif couvrant le canal. Cette semaine. Le lien ouvre la commandite pour vérifier aussi ses conditions de publication.                  |
| Publication en retard     | Créneau actif, lot planifié ou brouillon planifié/approuvé dont l’échéance est atteinte. Aujourd’hui, puis urgent après 48 heures.                                                                  |
| Créneau proche            | Créneau ouvert ou planifié dans les 168 prochaines heures. Aujourd’hui si sa date locale est celle du jour, sinon cette semaine.                                                                    |
| Publication prête         | Brouillon approuvé autonome ou lot ouvert non vide dont tous les brouillons sont approuvés. Aujourd’hui. Les validations existantes restent obligatoires au moment de publier.                      |
| Courriel en échec         | État `failed`; urgent si les tentatives sont épuisées, sinon aujourd’hui. Aucun destinataire complet ni erreur brute dans la file.                                                                  |
| Facture manquante         | Commandite payée, remboursée ou en litige, avec référence de session Stripe et sans facture. Aujourd’hui. Même admissibilité que le backfill existant; la revue n’est pas une condition d’émission. |
| Événement Stripe en échec | État enregistré `failed`. Urgent. Aucun appel Stripe lors de la lecture.                                                                                                                            |
| Événement Stripe bloqué   | État `processing` depuis au moins 15 minutes après réception. Urgent. La file ne relance pas l’événement.                                                                                           |
| Point financier           | Présence de paiements en litige selon la projection existante. Aujourd’hui. Aucune nouvelle formule monétaire.                                                                                      |

La priorité précède l’échéance, puis l’identifiant stable départage les tâches. Les relations de publication sont dédupliquées selon **créneau actif → lot actif → brouillon autonome**. Des obligations distinctes d’un même dossier, comme une fiche incomplète et une facture manquante, restent deux interventions.

Le filtre « À traiter aujourd’hui » inclut les urgences, les priorités `today` et les échéances dont la date locale est atteinte. Le filtre « En retard » exige une échéance antérieure à l’instant de lecture. Les tâches sans échéance restent accessibles avec leur filtre propre. Les dates visibles et la journée métier utilisent `America/Toronto`.

## Contrats et couverture

### Lecture de la file

`GET /api/admin/attention` et l’alias `/admin/attention` vérifient l’autorisation administrative côté API et utilisent le limiteur administratif existant. La réponse est privée et non mise en cache.

Paramètres facultatifs :

| Paramètre  | Valeurs                                                                                                     |
| ---------- | ----------------------------------------------------------------------------------------------------------- |
| `page`     | Entier de 1 à 1 000 000; défaut 1. Une page devenue hors limites est ramenée à la dernière page disponible. |
| `pageSize` | Entier de 1 à 100; défaut 25, résumé du cockpit à 4.                                                        |
| `type`     | Une des onze valeurs de `AdminAttentionItemType`.                                                           |
| `priority` | `urgent`, `today`, `this_week`, `informational`.                                                            |
| `due`      | `all`, `today`, `overdue`, `this_week`, `undated`.                                                          |
| `itemId`   | Identifiant d’une alerte précise; maximum 200 caractères.                                                   |

La réponse [AdminWorkQueueResponse](../packages/funding-core/src/admin-work-queue.ts) contient `total`, `filteredTotal`, `todayTotal`, `counts`, `typeCounts`, `items`, la pagination, `generatedAt`, `timezone` et l’état de couverture.

Les compteurs sont calculés sur **l’ensemble analysé avant pagination**. Le chargement interne de cette file ne reprend pas les anciennes limites de 100 publications, 150 courriels ou 2 000 commandites. Les endpoints historiques conservent leurs limites par défaut. Le résumé historique de l’Assistant conserve son contrat et ses limites; il sera traité séparément au lot 3.

Une DB absente ou des tables opérationnelles manquantes donnent `available: false`, `coverage: unavailable` et `missingSources`. L’interface ne présente alors aucun compteur comme une preuve d’absence de travail. Une erreur de requête produit HTTP 502. Les paramètres invalides produisent HTTP 400; une requête non autorisée produit HTTP 401.

### Destinations précises et génération ciblée

Les lectures existantes acceptent maintenant des filtres facultatifs, appliqués **avant** leur limite :

- `GET /api/admin/email-queue?messageId=…`;
- `GET /api/admin/publication-drafts?draftId=…`;
- `GET /api/admin/publication-batches?batchId=…`;
- `GET /api/admin/publication-slots?slotId=…`;
- `GET /api/admin/sponsorship-invoices?contributionId=…`.

`POST /api/admin/sponsorship-invoices/backfill` accepte désormais `contributionId`, UUID validé côté serveur. La sélection des candidats **et** ses compteurs sont limités à cette contribution. L’interface transmet également `limit: 1`. L’unicité de facture par contribution et l’implémentation idempotente existante sont conservées. Une valeur ciblée invalide est rejetée; elle ne devient pas une demande globale.

Aucune migration, variable d’environnement ou opération manuelle de production n’est requise. Les tables des migrations existantes doivent déjà être disponibles.

## Composition UI

- `AdminAttentionPageComponent` : page routée dans le layout admin du lot 1.
- `AdminAttentionPanelComponent` : organisme Funding; charge la file ou son résumé, gère les filtres, les erreurs, la session et les réponses concurrentes.
- `AdminAttentionListComponent` : organisme de présentation; reçoit les tâches et construit les liens de retour. Il n’effectue aucune mutation.
- Navigation, dashboard et pages de destination existants : intégration ciblée. Leur harmonisation visuelle complète reste prévue au lot 7.

Les composants sont standalone, OnPush, avec état local en signals et hooks `data-og7`. Les lectures initiales sont protégées pour le navigateur. Le rendu administratif reste en mode client; le prérendu des pages publiques est préservé.

## Validations exécutées

- `yarn test` : **197 tests Node réussis**, dont règles de priorité, limites temporelles, déduplication, pagination au-delà de 100 résultats, confidentialité et contrôle HTTP de l’autorisation.
- Compilation Angular : **22 routes publiques prérendues**, compilation réussie.
- `tests/tsconfig.admin-ui.json` : vérification de types réussie.
- Suite `tests/playwright-admin-ui.config.mjs` : **19 scénarios réussis**, dont dix pour le lot 2 et neuf de régression du lot 1. Captures sous `test-results/admin-layout`.
- PostgreSQL 16 isolé : migrations existantes appliquées à une base jetable, puis **un scénario d’intégration réussi** avec 2 005 commandites, 160 courriels, 110 brouillons, 110 lots et 110 créneaux. Vérification de 4 501 interventions, des objets hors première page, d’une génération ciblée répétable et de l’absence de courriel créé par cette génération.
- Lint ciblé réussi. Les contrôles globaux signalent encore 15 erreurs d’import et un avertissement lint dans des fichiers hors périmètre, ainsi que des écarts de formatage hérités. Aucun reformatage général du dépôt.
- `git diff --check` réussi.

Commandes reproductibles sous Node 22 :

```sh
yarn test
yarn test:ui:admin
```

Depuis le lot 8, le test PostgreSQL crée lui-même une base jetable avec Docker local. Reproduction avec Node 22 et Yarn 4 :

```sh
docker pull postgres:16-alpine
yarn build
node --test tests/integration/admin-work-queue.integration.mjs
```

Ce test vérifie une base vide, applique les migrations et insère uniquement des fixtures synthétiques. Il ne lit ni `.env` ni `ATTENTION_TEST_DATABASE_URL` et ne s’ignore plus faute de variable. Son conteneur est supprimé en fin d’exécution. Voir la [recette actuelle](./admin-ux-lot-8.md) ; les résultats ci-dessus décrivent la validation initiale du lot 2.

## Limites et suite

La projection charge actuellement l’ensemble des données nécessaires en mémoire côté API. Elle a été vérifiée au-delà des anciennes limites, mais ne constitue pas un test de charge à grande échelle. Les lectures des différentes sources ne forment pas un snapshot transactionnel unique; une mutation simultanée peut nécessiter une nouvelle actualisation.

Les scénarios navigateur utilisent des réponses contrôlées; le scénario PostgreSQL valide les repositories et règles réelles. La suite complète Docker/Stripe de bout en bout, les fournisseurs externes et la production n’ont pas été exercés. La consultation d’un événement Stripe prépare son investigation; elle n’ajoute aucun mécanisme de replay.

Le prochain lot est **l’Assistant contextuel**. Les badges des modules, le dossier en cours, les métriques enrichies et la recherche globale restent dans leurs lots respectifs.
