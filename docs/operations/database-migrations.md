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

La migration [027](../../apps/funding-api/migrations/027_create_contribution_activity.sql)
ajoute les événements de paiement, preuves de confirmation arrivées en avance,
préparations privées, réceptions SMS simulées et réservations de toasts par acteur.
Elle marque les paiements déjà confirmés comme historiques, sans créer d’alertes.
Cette mise à jour parcourt les contributions existantes : prévoir sa durée et
ses verrous selon le volume. Voir le [contrat d’activité](contribution-activity.md).

Sur une base Docker locale neuve et explicitement dédiée à ce projet :

```sh
yarn db:migrate
```

Le raccourci lance `scripts/db-migrate.mjs`, démarre le service PostgreSQL privé
et attend sa disponibilité. Le runner Bash `scripts/db-migrate.sh`, utilisé par
le déploiement VPS, délègue au même moteur. **Node 22 et Docker Compose** sont
requis sur l'hôte, même pour une livraison d'images déjà construites ; aucun
package npm ni build API n'est nécessaire au runner.

La cible est le service Compose `postgres`, avec `POSTGRES_DB` et `POSTGRES_USER`.
Vérifier le projet/fichier Compose et leur concordance avec la base utilisée
par l'API : le runner ne se connecte pas directement à `DATABASE_URL`.
Les variables du shell priment sur le fichier `OPENG7_E2E_ENV_FILE`, ou `.env`
par défaut. `MIGRATIONS_DIR` désigne le répertoire **complet** des migrations.

## Registre et réexécution

Le registre `public.openg7_schema_migrations` conserve numéro, nom, empreinte
SHA-256, date, rôle PostgreSQL, action (`applied` ou `baseline`) et référence
d'adoption éventuelle. Son schéma d'outillage est défini séparément dans
[`scripts/sql/001_migration_registry.sql`](../../scripts/sql/001_migration_registry.sql).
Les migrations applicatives historiques restent inchangées.

Les noms suivent `NNN_nom.sql`, avec numéro positif unique. L'empreinte utilise
le contenu UTF-8 après normalisation CRLF → LF pour les checkouts Windows/Linux.
Un fichier appliqué absent, renommé ou modifié bloque tout le lot. Un nouveau
numéro inférieur à une migration déjà enregistrée est aussi refusé.

Le moteur prend un [verrou transactionnel PostgreSQL](https://www.postgresql.org/docs/16/explicit-locking.html#ADVISORY-LOCKS)
commun, contrôle tout l'historique,
puis applique uniquement les fichiers manquants dans une transaction unique.
SQL et inscriptions au registre sont validés ensemble ; un échec annule le lot
en attente. Les migrations déjà validées lors d'une exécution précédente restent
acquises. L'attente de verrou est limitée à 30 secondes, l'exécution du bloc à
5 minutes. Évaluer les volumes et les verrous sur une copie avant livraison.
Les commandes hors transaction, dont `CREATE INDEX CONCURRENTLY`, et le contrôle
transactionnel dans une migration ne sont pas pris en charge par ce moteur.

Pour inventorier une cible déjà démarrée, sans créer de registre ni démarrer
PostgreSQL :

```sh
node scripts/db-migrate.mjs --plan
# Même opération depuis le point d'entrée VPS :
bash scripts/db-migrate.sh --plan
```

`pending` signifie non enregistré ; `skipped`, enregistré avec empreinte conforme.
Le plan ne vérifie pas une dérive manuelle du schéma ni les effets métier d'un
fichier SQL. Les détails SQL bruts ne sont pas imprimés, car une erreur peut
contenir des données privées. Une erreur ou une perte de connexion interdit
d'annoncer une réussite : réconcilier avec `--plan` et le registre avant reprise.

## Adoption d'une base existante sans registre

Une base non vide sans registre est refusée, y compris par `--plan`. Le moteur
ne devine pas les migrations appliquées à partir des tables présentes. Cela
concerne les bases créées par les anciens runners, qui rejouaient tous les SQL
et pouvaient laisser une migration partiellement appliquée.

1. Identifier cible, révision, rôle et responsable ; vérifier une sauvegarde.
2. Inventorier le schéma et les preuves d'exécution. Déterminer le dernier
   fichier d'un préfixe **entièrement** appliqué. Une table présente ne suffit
   pas à prouver les mises à jour de données, contraintes ou triggers.
3. Exercer l'adoption et les seules migrations restantes sur une copie isolée.
   Tout état partiel ou ambigu exige une réconciliation avant adoption.
4. Après instruction explicite pour la cible, enregistrer le préfixe vérifié,
   avec confirmation exacte du nom de base et référence non secrète de la revue :

```sh
# Exemple de forme uniquement : remplacer chaque valeur après revue.
node scripts/db-migrate.mjs \
  --baseline-through <NNN_derniere_migration_verifiee.sql> \
  --confirm-database <POSTGRES_DB_exact> \
  --baseline-reference <identifiant-de-revue>
```

L'adoption ne démarre pas PostgreSQL, n'exécute aucun SQL applicatif et laisse
les fichiers suivants en attente. Elle est refusée sur base vide ou déjà suivie.
La référence accepte lettres ASCII, chiffres, point, tiret, soulignement et
deux-points, sur 1–100 caractères. Elle est conservée avec le rôle et la date.
Relire ensuite le plan avant l'application autorisée des fichiers restants.
Une adoption ne prouve pas le schéma : l'opérateur atteste le préfixe revu.

## Recette locale du moteur

```sh
node --test tests/database-migrations.test.mjs
node --test tests/integration/database-migrations.integration.mjs tests/integration/database-migration-cli.integration.mjs
```

Les intégrations utilisent PostgreSQL 16 jetable, sans `.env` réel. Elles exercent
les 27 migrations applicatives, le deuxième passage sans rejeu, les empreintes,
la concurrence, l'échec et la coupure de connexion, puis l'adoption d'un schéma
existant. Une pile Compose distincte vérifie les commandes Node/Bash et l'absence
de données SQL privées dans les erreurs. Aucun port de cette pile n'est publié.
Les fixtures sont supprimées en fin d'exécution. Le dump/restauration vers une
seconde base conserve aussi le registre et permet une reprise sans rejeu.

Validation du 25 septembre 2026, base `d8cdd0d` avec ce correctif local, Windows
et Node 22.23.2 : **349 tests Node**, compilation TypeScript et **9 tests
d'intégration** du moteur/des commandes réussis. Syntaxe Bash, lint et contrôles
documentaires passent ; le lint conserve son avertissement préexistant dans
`scripts/smoke-public.mjs`. Aucune migration d'une base existante réelle n'a été
exécutée, et cette recette ne valide pas les volumes ni les verrous d'un VPS réel.

## Validation et retour

Après une application autorisée, vérifier les tables/contraintes attendues,
les parcours concernés et l'absence de régression des totaux. Le rollback des
images ne restaure pas la base. Une restauration est une opération distincte;
les [recettes jetables](integration-rehearsal.md) décrivent les preuves locales
et les limites de la restauration complète du VPS.
