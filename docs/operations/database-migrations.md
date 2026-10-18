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
fonctions persistantes, Checkout, OIDC et les alertes. Sans base, seuls les
parcours de transparence et de simulation en développement restent disponibles.

La migration [030](../../apps/funding-api/migrations/030_create_database_backups.sql)
ajoute les demandes et le heartbeat du service indépendant de sauvegarde. Elle ne
lance aucune capture et ne configure aucun stockage. Voir le
[parcours de sauvegarde admin](admin-database-backups.md).

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

La migration [058](../../apps/funding-api/migrations/058_preparation_assistance.sql)
ajoute les sources textuelles privées versionnées, jobs locaux durables,
propositions, revues et reçus idempotents de l’assistance aux accords historiques.
L’appliquer avant l’API correspondante, puis rafraîchir les grants du rôle
applicatif avec le runner à jour. Sources, propositions, revues et reçus restent
immuables ; les jobs conservent leurs entrées immuables et un état opérationnel
modifiable. Aucun dossier existant n’est qualifié et aucun traitement ou envoi
n’est créé par la migration. Voir les
[états et limites de l’assistance](../technical/preparation-assistance.md).

La migration [059](../../apps/funding-api/migrations/059_preparation_structured_analysis.sql)
autorise l’adaptateur de proposition structurée `local_rules_v2` en conservant
`local_rules_v1`. L’appliquer avant l’API correspondante ; la garde de démarrage
vérifie cette compatibilité. Elle ne réanalyse aucune source et ne modifie aucun
résultat ou engagement. Les anciens jobs se terminent en v1 ; seuls les nouveaux
jobs utilisent v2. Un index unique empêche deux jobs actifs sur les mêmes entrées,
y compris entre adaptateurs. Le modèle commercial et les grants existants sont conservés.
Arrêter les anciennes instances de l’API et leurs workers avant le démarrage de
cette version, pour qu’aucun ancien worker ne réserve un job v2.

La migration [031](../../apps/funding-api/migrations/031_create_checkout_operations.sql)
ajoute les opérations Checkout privées et leur clé unique, sans modifier les
contributions ni les faits financiers existants. Elle conserve les paramètres
Stripe et le résultat nécessaires aux reprises. L'appliquer avant l'API mise à
jour; Checkout configuré exige désormais PostgreSQL. Voir le
[contrat et la reprise Checkout](../technical/checkout.md).
Une migration de production reste une opération séparément autorisée.

La migration [032](../../apps/funding-api/migrations/032_keep_approved_sponsor_media_private.sql)
permet l'approbation des médias sans copie publique dans le stockage. L'appliquer
avant l'API mise à jour. Elle conserve les données et références historiques;
la diffusion passe désormais par une URL API contrôlant la visibilité du dossier.
Les anciennes copies publiques et leurs caches demandent une remise en conformité
séparément autorisée, décrite dans le [runbook de stockage](ovh-object-storage.md).

La migration [033](../../apps/funding-api/migrations/033_add_email_delivery_uncertainty.sql)
ajoute l'état `uncertain` et un identifiant de tentative aux courriels. L'appliquer
avant l'API mise à jour. Elle préserve les messages et ne lance aucun envoi.
Une tentative SMTP ambiguë ou un bail d'envoi expiré exige une réconciliation
administrative avant toute reprise; voir le [guide SMTP](../email-smtp.md).

Les migrations [034](../../apps/funding-api/migrations/034_create_sponsorship_moderation.sql)
à [040](../../apps/funding-api/migrations/040_allow_versioned_draft_restrictions_during_delivery.sql)
ajoutent les décisions éditoriales versionnées, corrections, recours, acceptations
de charte et observations de retrait/conservation. Les appliquer avant l'API
correspondante. La charte publique reste inactive. `038` observe les contenus déjà
publics sans fabriquer une décision N0; une modification ou restriction invalide
ce maintien historique. Tout nouvel envoi exige une revue explicite.
Voir [modération, adoption et reprise](sponsorship-moderation.md). Un retour à une
API antérieure retire ces gardes : garder les envois désactivés pendant la reprise.
Le rôle API dédié peut lire et verrouiller les politiques; leurs statuts et
activation restent réservés au propriétaire de migrations. Le droit technique
`UPDATE(version)` permet le verrouillage; `039` interdit de changer cette version.
Réappliquer les grants avec le runner
mis à jour lors de l'adoption, sans transférer la propriété des tables.
`040` permet la projection d'un refus versionné de brouillon pendant un envoi
déjà restreint; elle maintient l'interdiction de modifier son contenu ou son lot
tant qu'une livraison est autorisée, en cours ou incertaine.

La migration [041](../../apps/funding-api/migrations/041_sponsorship_commitments.sql)
ajoute les offres commerciales immuables, engagements, obligations et changements
administratifs traçables. L'appliquer avant l'API et le Web correspondants. Elle
classe les dossiers payés, remboursés ou contestés existants sans offre enregistrée
en `historical_unverified` / `needs_confirmation`, sans recalculer le barème ni créer
de prestations rétroactives. Une qualification explicite du propriétaire exige
une référence de preuve et conserve la provenance historique. Aucun paiement,
remboursement, revue, visibilité ou envoi n'est déclenché par cette migration.
Les obligations `fulfilled` exigent une référence de preuve ; un simple ancien
statut publié ne remplit pas cette condition. Voir le
[contrat Checkout](../technical/checkout.md) et les
[routes d'engagements](../technical/admin-api.md).

La migration [045](../../apps/funding-api/migrations/045_sponsorship_publication_formats.sql)
ajoute le format nullable aux obligations sociales et l'ajustement audité `format`.
Elle ne modifie aucun snapshot d'offre ni empreinte historique. `NULL` conserve
l'absence de promesse d'image; aucune prestation, approbation ou diffusion n'est
créée. Appliquer avant les contrats de formats de l'API/Web correspondants.

Les migrations 042 à 050 complètent ce chantier : compte effectif, preuves de
livraison, droits et préférences des médias, libération des réservations sans
DELETE, dérivés visuels, passages successifs et projection de modération sans
clés privées. L'ordre, les effets sur les anciennes photos et la reprise sont
détaillés dans le [guide d'adoption](sponsorship-delivery-adoption.md).
Les nouvelles N0 exigées par un changement de contenu restent humaines ; ces
migrations ne qualifient aucun ancien accord et ne déclenchent aucun envoi.

La migration [051](../../apps/funding-api/migrations/051_sponsorship_obligation_timing.sql)
ajoute les termes temporels par obligation, les observations des sources du site
OpenG7 et les attestations humaines de durée. Les délais et durées viennent du
snapshot immuable existant. Aucune origine, échéance historique, continuité ou
réalisation n'est inférée. Les anciennes obligations gardent leurs états et
preuves; le propriétaire documente l'origine avant de calculer une échéance.
Les observations et attestations sont immuables, sans droits API de réécriture
ou suppression. Le calendrier conserve une version distincte et une origine
enregistrée une seule fois. Voir le [contrat temporel](../technical/sponsorship-obligation-timing.md).

La migration [052](../../apps/funding-api/migrations/052_sponsorship_historical_evidence_reviews.sql)
ajoute les examens historiques immuables, leur version et leur clé de requête
uniques, ainsi que les index de lecture des preuves. Elle ne lance aucun examen
et ne modifie aucune preuve, obligation, autorisation, visibilité ou donnée
financière. Voir l'[audit historique](../technical/sponsorship-historical-audit.md).
Appliquer ces deux migrations après 050 et avant l'API/Web correspondants, puis
rafraîchir les grants du rôle applicatif avec le runner à jour. Les gardes de
démarrage vérifient que ce rôle ne peut réécrire ni supprimer ces observations,
attestations et examens. Les parcours de fiabilité restent des lectures;
une migration ne résout aucun incident ou résultat fournisseur incertain.

La migration [053](../../apps/funding-api/migrations/053_publication_provider_media_evidence.sql)
ajoute les références LinkedIn ordonnées à la preuve immuable de chaque prestation.
Les anciennes preuves gardent une liste vide, sans inférer les images d’un ancien
post ni modifier les snapshots, empreintes ou états commerciaux. L’appliquer
avant l’API correspondante ; elle n’active aucun envoi ni réconciliation.
Les nouvelles collections conservent le cache d’upload privé existant et exigent
une approbation du message et de chaque JPEG exact. Voir les
[formats et limites de reprise](../technical/publication-formats.md).

La migration [054](../../apps/funding-api/migrations/054_sponsorship_public_visibility_observations.sql)
ajoute les observations HTTP immuables liées aux débuts du calendrier existant,
et un curseur opérationnel durable. Elle ne crée ni période, attestation,
réalisation ni requête réseau. L’appliquer avant l’API correspondante et rafraîchir
les grants avec le runner à jour : lecture/insertion des observations, sans
réécriture ni suppression. Le worker reste désactivé par défaut ; voir les
[observations et limites temporelles](../technical/sponsorship-obligation-timing.md#observations-http-périodiques-désactivées-par-défaut).

La migration [029](../../apps/funding-api/migrations/029_create_sponsorship_refund_operations.sql)
ajoute les demandes de remboursement durables et leur exclusion mutuelle.
Elle ne modifie aucun fait financier existant. L'appliquer avant l'API mise à
jour; voir [confirmation et reprise](stripe-refund-integrity.md).

La migration [028](../../apps/funding-api/migrations/028_create_admin_stripe_backfills.sql)
ajoute les aperçus et résultats du [rattrapage Stripe administratif](admin-stripe-backfill.md).
Elle ne modifie aucune contribution et ne lance aucun import. L'appliquer avant
de démarrer l'API et le Web mis à jour.

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
le déploiement VPS, délègue au même moteur. **Node 22 ou supérieur et Docker Compose** sont
requis sur l'hôte, même pour une livraison d'images déjà construites ; aucun
package npm ni build API n'est nécessaire au runner.

La cible est le service Compose `postgres`, avec `POSTGRES_DB` et `POSTGRES_USER`.
Vérifier le projet/fichier Compose et leur concordance avec la base utilisée
par l'API : le runner ne se connecte pas directement à `DATABASE_URL`.

Le propriétaire de migrations reste distinct du compte API. Sur une base neuve,
appliquer d'abord les migrations, puis préparer le
[rôle applicatif limité](../docker-deployment.md#compte-postgresql-applicatif).
Le provisionnement est une opération explicite, avec aperçu sans connexion et
confirmation de la base et du rôle; aucun secret existant n'est remplacé.
Lorsque `FUNDING_DATABASE_RUNTIME_USER` est configuré, le runner rafraîchit ses
droits sur le schéma résultant dans la même transaction que les migrations.
L'API de production refuse de démarrer avec un superutilisateur, une appartenance
à un autre rôle, des droits de création ou de suppression métier, ou la capacité
de réécrire le journal d'audit et le registre. Elle reçoit seulement son
`DATABASE_URL`, sans identifiants PostgreSQL du propriétaire.

Les variables du shell priment sur le fichier `OPENG7_E2E_ENV_FILE`, ou `.env`
par défaut. `MIGRATIONS_DIR` désigne le répertoire **complet** des migrations.

## Registre et réexécution

Les migrations `060_sponsor_media_workspace.sql` et `061_sponsor_media_analysis.sql`
ajoutent les règles média versionnées, lots, plans/reçus collectifs, sélection Web
et analyses privées. Elles ne lancent aucun traitement ni publication. Les médias
historiques conservent leurs droits et références ; aucun consentement n'est inféré.
Rafraîchir les grants du rôle runtime avant le démarrage de la nouvelle API.
Les gardes vérifient les deux schémas et la protection des preuves immuables.
Un ancien serveur ignorant l'héritage ne constitue pas un retour sûr : arrêter les
traitements et privilégier une correction en avant. Voir les
[contrats média et la reprise](../technical/sponsor-media-usage.md#revue-par-lot-et-héritage).

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
