# Lot 5 — Indicateurs, activité et état des systèmes

Réalisé à partir de `main` (`f99c40e`, PR #112), sur la branche `feat/admin-cockpit-metrics-activity-health`, selon le [plan](./admin-ux-plan-de-travail.md), les [requis](./admin-ux-direction.md) et la [maquette](./images/admin-ui.png).

Risque modéré : nouveaux contrats de lecture et projections administratives. Les écritures financières et les opérations de production restent hors de ce changement.

## Résultat visible

- Quatre indicateurs : encaissements, net des encaissements, dossiers de commandite avec paiement confirmé et publications prévues. Sélection de devise pour les montants; les comptes de dossiers couvrent toutes les devises.
- Courbes issues des encaissements quotidiens, valeurs accessibles dans un tableau, comparaison de deux périodes de 30 jours calendaires complets en `America/Toronto`. La journée en cours est exclue de la comparaison, mais reste incluse dans les totaux cumulés.
- Frais manquants, sources partielles, paiements sans date et anomalies de rapprochement explicitement signalés.
- Activité transverse et compteurs du jour : paiements, factures, publications, revues, demandes d’informations et remboursements. Chaque entrée ouvre l’objet ou le dossier exact.
- États Stripe, SMTP, stockage local/OVH S3 et PostgreSQL avec preuve, date de contrôle et expiration. Une observation périmée perd son indication « opérationnel », même sans rechargement.
- Actualisation indépendante de chaque bloc; dernière lecture signalée après une panne, contenu effacé sur un refus d’accès, session effacée sur un 401. Les réponses obsolètes ne remplacent pas une lecture plus récente.
- Nouveaux blocs FR/EN, standalone, OnPush, clavier et SSR. Assistant, activité et systèmes partagent une rangée sur grand écran et se réorganisent sur mobile. Les vues détaillées historiques restent accessibles sous le cockpit.

## Contrats et lecture du code

Trois nouveaux endpoints GET protégés, avec alias sans `/api`, limitation de débit administrative et `Cache-Control: private, no-store` :

| Endpoint                      | Source / responsabilité                                                                |
| ----------------------------- | -------------------------------------------------------------------------------------- |
| `/api/admin/cockpit/metrics`  | [Projection financière et comptage](../apps/funding-api/src/admin-cockpit/metrics.ts). |
| `/api/admin/cockpit/activity` | [Activité et déduplication](../apps/funding-api/src/admin-cockpit/activity.ts).        |
| `/api/admin/cockpit/systems`  | [Observations, délais et cache](../apps/funding-api/src/admin-cockpit/systems.ts).     |

Les [contrats partagés](../packages/funding-core/src/admin-cockpit.ts) sont additifs. Aucun changement au contrat historique `/admin/dashboard`, aux projections publiques, aux webhooks ou aux écritures financières.

Le [lecteur PostgreSQL](../apps/funding-api/src/admin-cockpit/read.ts) utilise des transactions `REPEATABLE READ READ ONLY`, un délai d’acquisition de connexion de 2 secondes et un `statement_timeout` de 5 secondes par requête. Une connexion obtenue après expiration est rendue au pool. Chaque bloc a son propre instantané : les blocs ne constituent pas une transaction commune.

Les [composants Angular](../apps/funding-web/src/app/features/funding/components/admin-cockpit/) distinguent orchestration locale, présentation des statuts et présentation des séries. Le layout ne calcule aucun montant financier.

## Méthode financière — points de transfert

Toutes les valeurs du nouveau contrat sont en **unités mineures entières**, avec devise explicite. Les valeurs invalides ou dépassant la précision entière sûre provoquent un échec de lecture. Le navigateur applique uniquement le format monétaire de la devise.

| Valeur                   | Définition                                                                                                                                                               |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Brut                     | Contributions enregistrées dans les états `paid`, `refunded` et `disputed`, sans addition des écritures Stripe correspondantes.                                          |
| Frais connus             | Frais d’une transaction `payment_intent.succeeded` rapprochée du paiement, avec identifiant de balance transaction, devise et brut concordants, et `net = amount - fee`. |
| Net des encaissements    | Brut moins frais confirmés. `null` dès qu’un encaissement du périmètre manque de frais confirmés.                                                                        |
| Remboursements           | Faits confirmés rapprochés par dossier : remboursements distincts, instantanés cumulatifs par charge et faits historiques de backfill.                                   |
| Litiges                  | Brut des dossiers actuellement `disputed`, présenté séparément. Il ne s’agit pas d’une mesure du montant effectivement débité par Stripe.                                |
| Net après remboursements | Net des encaissements moins remboursements confirmés. Les dépenses, litiges et ajustements des frais de remboursement restent hors de cette formule.                     |

**Aucun solde disponible n’est affirmé.** Les allocations existantes ne constituent pas une preuve de dépenses réalisées. Un payout Stripe est un transfert vers la banque, pas une dépense du fonds.

### Rapprochement et données incomplètes

- Plusieurs écritures du même PaymentIntent ne multiplient pas les frais. Une écriture disposant d’une balance transaction est préférée à une écriture incomplète.
- Plusieurs dossiers liés au même PaymentIntent comptent une seule fois. Un avertissement invite à rapprocher ces dossiers.
- Les écritures Stripe sans contribution confirmée correspondante sont exclues de ce périmètre et signalées. Ce cockpit n’est pas une réconciliation exhaustive du compte Stripe.
- Un frais absent n’est jamais confirmé comme zéro. Une réception tardive complète la période d’encaissement initiale.
- Les remboursements répétés sont dédupliqués par identifiant; plusieurs instantanés d’une charge utilisent leur maximum. Les faits par charge et par remboursement ne sont pas additionnés entre eux.
- Les backfills existants conservent des totaux cumulés par charge. Un montant partiel confirmé prime sur un ancien statut `refunded`; le statut seul sert de repli lorsqu’aucun montant confirmé n’est disponible.
- Les notes de crédit ne constituent pas des preuves de remboursement. Une devise de remboursement contradictoire invalide la projection.
- Sans date de paiement, le total demeure présent mais la tendance concernée est indisponible. Une période précédente nulle ne produit pas un pourcentage de croissance fictif.

Les lectures financières n’utilisent pas les limites des listes admin. Elles chargent néanmoins les faits monétaires en mémoire : la validation de volume ne constitue pas un benchmark de charge.

## Unité de publication et activité

« Publications prévues » compte une fiche active par **commandite + cible + canal**, dans les états `draft`, `approved` ou `scheduled`. Une annulation du lot ou du créneau exclut la fiche. Lots et créneaux sont des conteneurs et ne sont pas comptés en supplément; un créneau vide n’est pas une publication.

La variation historique du nombre de fiches actives reste explicitement indisponible : les états actuels ne permettent pas de reconstruire ce stock passé. Les badges de navigation du lot 4 continuent à compter les interventions selon la file « À traiter ».

L’activité affiche les huit entrées les plus récentes. Les compteurs du jour sont calculés avant cette limite. Les faits de paiement, facture et publication viennent de leurs tables; leurs audits ne sont pas ajoutés une seconde fois. Les retries des demandes d’informations et remboursements sont dédupliqués par identifiant de message/remboursement. Une publication enregistrée ne prouve pas une diffusion sociale réelle; les tentatives et leur mode restent consultables dans le dossier.

Le flux ne retourne ni courriel, ni corps de message, ni note privée, ni payload Stripe. Les sources manquantes donnent des compteurs `null` et un avertissement d’activité partielle.

Le compteur « Remboursements admin » porte sur les confirmations auditées des opérations administratives; ce n’est pas un historique exhaustif de tous les remboursements effectués directement dans Stripe.

## Santé — portée exacte des preuves

| Système        | Preuve utilisée                                                                                                                                          |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Stripe         | Webhook de paiement traité depuis moins de 15 minutes; échecs persistants ou traitements bloqués dégradent l’état. Aucune requête Stripe supplémentaire. |
| SMTP           | Message remis au transport depuis moins de 15 minutes; échecs et messages en retard dégradent l’état. Aucun courriel de test envoyé.                     |
| Stockage local | Lecture des caractéristiques et droits d’accès du répertoire existant. Aucun répertoire ou fichier créé.                                                 |
| OVH S3         | `HeadBucket` sur les buckets privé et public, avec annulation sur expiration. Aucun objet écrit ou publié.                                               |
| PostgreSQL     | Requête de lecture réelle.                                                                                                                               |

Les contrôles sont exécutés en parallèle, bornés à 2,5 secondes et partagés entre requêtes simultanées. Cache d’au plus 60 secondes, raccourci si une observation arrive à expiration. Une configuration seule ou une observation trop ancienne produit `unknown`; une intégration désactivée/incomplète produit `not_configured`.

Un échec de lecture des observations SMTP/Stripe produit `unknown`, car il ne prouve pas une panne du fournisseur. Un contrôle direct de PostgreSQL ou du stockage qui échoue produit `unavailable`. Les réponses ne contiennent ni erreur brute, ni hôte privé, ni identifiant de connexion.

Ces preuves ne garantissent ni réception du courriel chez le destinataire, ni permission d’écriture dans le stockage, ni disponibilité de toutes les API du fournisseur.

## Validation

- `yarn test`, Node 22 : **222 tests réussis**, compilation API/packages comprise.
- `yarn test:ui:admin` : build Angular, **22 routes publiques pré-rendues** et **50 tests navigateur réussis**, dont huit scénarios du cockpit.
- PostgreSQL 16 jetable : scénario réussi avec **2 007 dossiers**, plusieurs devises, anciennes limites dépassées, frais tardifs, doublons de paiement, remboursements répétés/backfill, devise contradictoire refusée, sources manquantes et absence d’écriture à la consultation.
- Après les dernières retouches de présentation : build Angular et **17 scénarios cockpit/tableau de bord rejoués avec succès**.
- Captures desktop et mobile relues; absence de débordement également vérifiée sur tablette. Clavier, langue anglaise, états partiels, expiration des observations et réponses tardives couverts.
- ESLint des changements et format des nouveaux fichiers vérifiés. Le lint global conserve **14 erreurs d’import et un avertissement hors périmètre**. Le format global reste non vert; aucune remise en forme générale du dépôt n’a été effectuée.
- `git diff --check` réussi. Le conteneur PostgreSQL jetable et son volume ont été supprimés après validation; les services locaux déjà présents ont été conservés.

Reproduction : Node 22, Yarn 4, `yarn test` et `yarn test:ui:admin`.

Depuis le lot 8, l’intégration [PostgreSQL du cockpit](../tests/integration/admin-cockpit.integration.mjs) crée sa propre base jetable avec Docker local. Elle vérifie une base vide, applique les migrations existantes et crée uniquement des fixtures synthétiques. Elle ne lit ni `.env` ni `COCKPIT_TEST_DATABASE_URL` et ne démarre aucun worker.

```powershell
docker pull postgres:16-alpine
yarn build
node --test tests/integration/admin-cockpit.integration.mjs
```

Le scénario s’exécute systématiquement et supprime son conteneur en fin de test. Il est inclus dans `yarn test:integration:payments`, séparément de `yarn test`. Voir la [recette actuelle](./admin-ux-lot-8.md) ; les résultats ci-dessus décrivent la validation initiale du lot 5.

## Limites et suite

- Aucune migration nouvelle, variable applicative supplémentaire, opération de données ou modification des workflows financiers nécessaire.
- Les tests navigateur utilisent une API simulée; PostgreSQL valide les requêtes réelles séparément. La pile Docker applicative complète, Stripe réel, SMTP réel et OVH réel ne sont pas validés par ces suites.
- La recherche globale relève du **lot 6**. L’harmonisation des anciennes pages et la recette transverse restent respectivement dans les lots 7 et 8.
