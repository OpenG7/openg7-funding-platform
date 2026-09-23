# Migrations PostgreSQL : état et procédure

Vérification du code au 19 septembre 2026, après la PR #127.
Les fichiers sous `apps/funding-api/migrations/` sont la source de vérité.
Les migrations déjà appliquées restent immuables.

## Schéma disponible

| Migration                                                                               | Fonctionnalité                                              |
| --------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| [001](../../apps/funding-api/migrations/001_create_fund_transparency_tables.sql)        | Transactions et allocations                                 |
| [002](../../apps/funding-api/migrations/002_create_fundraiser_mvp_tables.sql)           | Contributions, Checkout et événements Stripe                |
| [003](../../apps/funding-api/migrations/003_add_sponsorship_details.sql)                | Détails commanditaires                                      |
| [004](../../apps/funding-api/migrations/004_add_sponsorship_review.sql)                 | Revue commanditaire                                         |
| [005](../../apps/funding-api/migrations/005_add_sponsorship_followup_token.sql)         | Jeton de suivi privé                                        |
| [006](../../apps/funding-api/migrations/006_add_sponsorship_publication_feed.sql)       | Profil public et publication                                |
| [007](../../apps/funding-api/migrations/007_add_admin_audit_and_publication_drafts.sql) | Audit et brouillons de publication                          |
| [008](../../apps/funding-api/migrations/008_add_sponsorship_publication_batches.sql)    | Lots de publication                                         |
| [009](../../apps/funding-api/migrations/009_add_contribution_public_reference.sql)      | Référence publique                                          |
| [010](../../apps/funding-api/migrations/010_create_email_messages.sql)                  | File de courriels                                           |
| [011](../../apps/funding-api/migrations/011_create_sponsorship_invoices.sql)            | Factures                                                    |
| [012](../../apps/funding-api/migrations/012_create_sponsorship_credit_notes.sql)        | Avoirs                                                      |
| [013](../../apps/funding-api/migrations/013_add_sponsorship_refund_status.sql)          | État du remboursement                                       |
| [014](../../apps/funding-api/migrations/014_add_sponsorship_refund_amount_reason.sql)   | Montant et raison du remboursement                          |
| [015](../../apps/funding-api/migrations/015_create_social_publication_jobs.sql)         | Jobs de publication sociale                                 |
| [016](../../apps/funding-api/migrations/016_create_publication_slots.sql)               | Créneaux de publication                                     |
| [017](../../apps/funding-api/migrations/017_create_sponsor_media_assets.sql)            | Médias commanditaires privés et copies publiques approuvées |
| [018](../../apps/funding-api/migrations/018_add_fund_achievement_tracking.sql)          | Avancement et preuves des réalisations/allocations          |
| [019](../../apps/funding-api/migrations/019_create_sponsorship_access_and_drafts.sql)   | Liens de reprise et brouillons commanditaires avec révision |
| [020](../../apps/funding-api/migrations/020_create_admin_identity.sql)                  | Comptes, sessions et challenges OIDC administratifs         |
| [021](../../apps/funding-api/migrations/021_create_operations_alerts.sql)               | Épisodes d'alertes et reprises de livraison                 |

Ajouts du 21 septembre 2026 : [022](../../apps/funding-api/migrations/022_create_publication_automation.sql) (moteur de publication), [023](../../apps/funding-api/migrations/023_prepare_publications_for_human_review.sql) (préparation privée) et [024](../../apps/funding-api/migrations/024_create_admin_command_receipts.sql) (reçus des commandes de pilotage).

Appliquer les dépendances dans l'ordre. PostgreSQL est nécessaire pour les
fonctions persistantes, OIDC et les alertes. Le mode Stripe-direct conserve
uniquement les parcours compatibles avec l'absence de base.

La migration [025](../../apps/funding-api/migrations/025_create_publication_editorial_profiles.sql)
ajoute les préférences éditoriales par destination et les observations de
corrections distinctes. Elle n'active aucun envoi et préserve les publications
existantes. Voir [Ma semaine](editorial-programme.md).

La migration [026](../../apps/funding-api/migrations/026_create_publication_worker_settings.sql)
ajoute l'état persistant du moteur automatique. Sa valeur initiale conserve le
réglage serveur existant; elle n'active aucun traitement. Appliquer cette migration
avant de démarrer l'API mise à jour. Le bouton On / Off, les droits et la reprise
sont décrits dans le [runbook de publication](publication-automation.md).

## Première application locale

Sur une base Docker locale neuve et explicitement dédiée à ce projet :

```sh
yarn db:migrate
```

Le raccourci lance `scripts/db-migrate.mjs`, démarre le service PostgreSQL
privé, attend sa disponibilité et applique les fichiers SQL dans l'ordre des
noms avec `ON_ERROR_STOP=1`. Le runner Bash `scripts/db-migrate.sh` est utilisé
par le déploiement VPS. Les deux prennent en charge `MIGRATIONS_DIR`.

## Limite actuelle sur une base existante

Les runners ne tiennent pas de registre des migrations appliquées : ils
exécutent tous les fichiers du répertoire à chaque appel. Les migrations
`019`, `020` et `021` utilisent notamment `CREATE TABLE` sans `IF NOT EXISTS`.
Les rejouer après leur application provoque une erreur de relation existante.
Un échec peut aussi laisser les instructions précédentes appliquées : le runner
ne place pas l'ensemble de la migration dans une transaction.

Cette limite touche `yarn db:migrate`, les raccourcis VPS de migration et
`scripts/deploy.sh` lorsque `DATABASE_URL` est configuré. Une compilation ou
une recette réussie sur PostgreSQL jetable ne valide pas une seconde livraison
sur le même schéma. Ne pas supprimer les tables ni modifier les migrations
historiques pour contourner l'erreur.

Pour une base existante, inventorier le schéma et les preuves d'application,
vérifier une sauvegarde, puis préparer les seuls scripts manquants dans leur
ordre et les exercer sur une copie isolée. `MIGRATIONS_DIR` permet de fournir
un répertoire préparé, mais ne détermine pas lui-même ce qui manque. Toute
application de production exige une opération exacte et explicitement autorisée.

La correction technique à prévoir est un suivi persistant des migrations,
commun aux runners local et VPS, avec vérification de leur empreinte,
verrouillage concurrent et tests de première application/reprise. Cette
révision documentaire n'implémente pas ce mécanisme.

## Validation et retour

Après une application autorisée, vérifier les tables/contraintes attendues,
les parcours concernés et l'absence de régression des totaux. Le rollback des
images ne restaure pas la base. Une restauration est une opération distincte;
les [recettes jetables](integration-rehearsal.md) décrivent les preuves locales
et les limites de la restauration complète du VPS.
