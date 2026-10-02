# Sauvegardes de la base depuis la configuration admin

La page `/admin/fundraiser/setup?section=backups` permet au propriétaire de
demander une sauvegarde et de consulter les vingt derniers résultats. Elle ne
télécharge ni ne restaure les données. Configuration initiale désactivée :
destination à choisir, une capture quotidienne UTC et protection minimale de
30 jours. Aucun déploiement ni stockage externe n'est créé par ce changement.

## Parcours dans l'application

La navigation « Sauvegardes » ouvre une section pleine largeur. Sa synthèse
sépare la dernière copie vérifiée dans l'historique, la cadence prévue et la
protection minimale prévue. Le statut du service ne certifie aucune copie.
Une observation dépassant une minute ou une lecture échouée retire le statut
disponible et bloque la demande; l'historique conservé est signalé comme ancien.

Avant activation, « Voir les étapes » présente destination indépendante, clé de
récupération et essai sur cible isolée. Ce guide ne configure aucun service.
L'historique affiche cinq opérations, extensibles aux vingt reçues. Dates en
America/Toronto, tailles lisibles et badges avec texte permettent de parcourir
les résultats; « Détails » ouvre dates, identifiant et preuves dans le panneau
latéral commun. Échap le ferme et restitue le focus. Une expiration de session
ou un refus d'accès ferme aussi le panneau et efface les métadonnées affichées.

Les demandes en attente, en cours ou incertaines ont une explication dédiée,
sans pourcentage de progression estimé. « Préparer une récupération » présente
les étapes indépendantes ci-dessous; il ne télécharge ni ne restaure de données.
Les guides restent consultatifs, sans écriture API.

## Périmètre et preuves

Le service indépendant `database-backup` capture **PostgreSQL seulement** avec
`pg_dump` 16, puis chiffre son flux avec [age](https://github.com/FiloSottile/age).
Le SQL privé n'est jamais écrit sur disque. La clé privée de déchiffrement reste
hors du serveur. Médias, paramètres, rôles PostgreSQL globaux et images ne sont
pas inclus; conserver aussi les [ensembles complets](backup-recovery.md).
Une capture DB ne synchronise pas les fournisseurs ni les fichiers.

La réussite exige un transfert S3 conditionnel, un verrou `COMPLIANCE` de 30 jours
et la relecture de la version exacte pour comparer taille et SHA-256. Cette preuve
ne constitue pas un essai de restauration. L'historique distingue date de demande,
début de capture et fin du traitement. Il ne démontre pas que la capture précède
une compromission passée inaperçue.

L'API ne reçoit ni clé de stockage ni archive. Le worker n'a ni socket Docker,
port entrant, clé de déchiffrement, droit S3 de suppression ou commande provenant
du navigateur. Le stockage doit rester privé et séparé des buckets de médias.
Le worker refuse un bucket non versionné, sans Object Lock, avec ACL partagée
ou politique de bucket présente. Utiliser des permissions d'identité dédiées;
une politique de bucket exige une revue et une adaptation explicites.

## Préparer l'activation

1. Appliquer `030_create_database_backups.sql` selon la
   [procédure de migration](database-migrations.md), d'abord sur une cible de test.
2. Préparer un bucket privé dédié avec versionnement et Object Lock. Donner au
   worker les lectures de configuration/ACL/politique, d'objets/versions/rétention,
   `PutObject` et `PutObjectRetention` sur le préfixe prévu. Aucun droit de suppression,
   de changement de politique/cycle de vie ou de contournement de la rétention.
   Une identité de récupération indépendante doit pouvoir retrouver les versions.
3. Vérifier côté stockage une expiration à 30 jours, y compris des versions anciennes.
   Object Lock impose un **minimum**; la suppression dépend du fournisseur et peut
   être différée. L'app ne supprime aucune archive distante et ne prétend pas
   limiter la conservation à exactement 30 jours.
4. Générer une identité age sur un poste de confiance, conserver sa clé privée
   indépendamment du serveur et transmettre seulement le destinataire public
   `age1…`. Exercer le déchiffrement avant d'activer la politique.
5. Préparer un rôle PostgreSQL dédié : connexion à la même base que l'API, usage
   du schéma `public`, `pg_read_all_data`, `SELECT/INSERT/UPDATE` sur les deux tables
   `database_backup_jobs` et `database_backup_worker`, `INSERT` sur `admin_audit_log`.
   Aucun privilège d'administration ni écriture financière. Revoir les éventuelles
   politiques RLS; ne pas contourner un dump refusé ou incomplet.
6. Copier [database-backup.env.example](../../database-backup.env.example) vers
   `.env.backup` privé (`0600`), distinct du `.env` chargé par l'API. Renseigner les
   variables puis activer `FUNDING_BACKUP_ENABLED=true` pour la cible autorisée.
   Le namespace identifie l'environnement. La connexion distante exige
   `sslmode=verify-full`; `sslmode=disable` est réservé au réseau Docker `data`
   existant. Une autorité privée nécessite un certificat monté en lecture seule
   et une configuration de confiance explicite, sans désactivation TLS.

Variables publiques : activation, namespace, destinataire age, endpoint HTTPS,
région, bucket et répertoire absolu de staging. Variables privées : URL PostgreSQL,
identifiant et secret S3. Aucune de ces variables ne va dans le bundle Web.

Après autorisation sur la cible, construire l'image API courante puis le service :

```sh
docker compose -f docker-compose.yml -f docker-compose.backup.yml --profile backup build database-backup
docker compose -f docker-compose.yml -f docker-compose.backup.yml --profile backup up -d database-backup
```

L'overlay lit `.env.backup` uniquement pour ce service; le chemin peut être remplacé
par `FUNDING_BACKUP_ENV_FILE`. Il ne démarre pas PostgreSQL à la place de l'opérateur.
Outils, clé publique et stockage sont contrôlés avant le statut disponible.
La première capture quotidienne commence dès que le worker est prêt; les suivantes
au premier passage après minuit UTC. Un jour échoué n'est pas rejoué automatiquement.

Limites : une opération active, 15 minutes entre demandes, 15 minutes pour le
traitement complet, archive chiffrée de 2 Gio maximum. Le staging exige 2 Gio plus
100 Mio libres. L'archive locale est retirée après réussite auditée, le reçu reste.
Les échecs et résultats incertains restent pour diagnostic : surveiller l'espace.
Le heartbeat est rafraîchi toutes les 20 secondes et périme après 90 secondes.
Un worker disponible ne prouve pas la réussite de sa dernière sauvegarde.

La taille maximale, la conservation, la fraîcheur et le délai de traitement sont
centralisés dans la [politique du worker](../../apps/funding-api/src/database-backup/policy.ts).

## Demandes et reprise

`GET /api/admin/backups` retourne politique, disponibilité horodatée et historique.
`?requestId=<UUID>` ajoute le reçu ou `null`. `POST` accepte exclusivement
`requestId` et `confirmation: "BACKUP_DATABASE"`, après le dialogue UI.
Session signée ou OIDC propriétaire requise; secret racine brut et accès local
sans session sont refusés. Origines Web vérifiées; réponses `private, no-store`.

États : `queued`, `running`, `succeeded`, `failed`, `unknown`. Acceptation et audit
atomiques. Même identifiant et acteur : même opération; acteur différent :
`409 BACKUP_REQUEST_CONFLICT`. Opération active/incertaine : `409`; délai minimal :
`429`; service indisponible : `503`; confirmation absente : `400`. Aucun chemin,
secret ou diagnostic fournisseur n'est exposé.

Après perte de réponse, l'UI consulte le même identifiant, conservé dans la session
du navigateur. Sans reçu, elle permet de confirmer le renvoi de **la même demande**.
Elle ne crée pas automatiquement un autre identifiant. Un worker interrompu laisse
un résultat incertain au redémarrage. Un verrou PostgreSQL interdit deux workers
actifs; les résultats incertains bloquent les demandes suivantes.

Pour réconcilier un transfert incertain, arrêter le worker puis, sur la cible
autorisée avec le même staging et la même destination :

```sh
docker compose -f docker-compose.yml -f docker-compose.backup.yml --profile backup stop database-backup
docker compose -f docker-compose.yml -f docker-compose.backup.yml --profile backup run --rm database-backup --reconcile <requestId>
```

La commande relit reçu et objet sans nouvel upload. Une preuve complète passe
`unknown` à `succeeded` avec audit. Sinon, préserver les traces, vérifier les versions
distantes et consigner une décision opérateur avant toute correction du reçu.
Aucun effacement ou renvoi automatique. Le redémarrage du worker est explicite;
ses nouvelles demandes quotidiennes reprennent alors.

## Récupération indépendante

Si l'app ou le serveur est compromis, utiliser une machine saine et les accès
indépendants. Identifier une version antérieure à l'incident, télécharger son
`.sql.age`, vérifier l'empreinte et déchiffrer avec
`age --decrypt --identity <clé-privée> --output <nouveau-fichier.sql> <archive.sql.age>`
dans un répertoire privé. Vérifier les chemins sans écraser de fichier existant.
Restaurer le SQL seulement dans une **nouvelle base isolée**, après autorisation.
Ce dump seul n'est pas un ensemble accepté par `restore-from-backup.sh`.

Garder écritures, courriels, publications et worker de sauvegarde arrêtés sur la
cible restaurée. Rapprocher médias, sessions/droits, secrets et faits Stripe avant
activation. La [procédure complète](backup-recovery.md) décrit les contrôles et
l'autorisation distincte de remise en service.

## Vérifications locales

```sh
yarn test
node --test tests/integration/database-backup.integration.mjs
node --test tests/integration/database-backup-capture.integration.mjs
yarn exec playwright test --config tests/playwright-admin-ui.config.mjs admin-backups-ui.spec.ts
```

La recette de capture construit l'image spécialisée et vérifie `pg_dump`, age,
le déchiffrement, les montants entiers exacts et l'import dans une seconde base
jetable. Elle vérifie aussi le refus de réutilisation, la corruption et l'interruption.
Elle ne contacte aucun stockage distant.

Elle exerce aussi le worker quotidien complet avec transfert simulé, puis coupe
ses seules connexions PostgreSQL : la sortie en échec permet son redémarrage par
Docker. Les demandes terminées ne sont pas rejouées.

Les autres intégrations utilisent PostgreSQL jetable et un transport simulé; les tests
UI utilisent des réponses interceptées. Ils ne qualifient pas IAM, la confidentialité
du fournisseur, la clé hors serveur ou un incident réel. Exercer une restauration
isolée avec le fournisseur choisi avant l'activation.

Validation locale du 30 septembre 2026, Node 22.23.3 et Yarn 4.9.4 : 416 tests
Node, deux intégrations API/persistance, neuf scénarios de migration, la recette
de capture/restauration et 18 scénarios UI de configuration réussis. Build
Angular/SSR (24 routes), TypeScript, lint, format ciblé, Compose et standards
vérifiés. Le lint conserve son avertissement préexistant dans `smoke-public.mjs`;
le contrôle documentaire signale seulement le budget CRLF préexistant de
`docs/command-cheatsheet.md`, inchangé. Aucun fournisseur réel ni production activé.

Refonte UI vérifiée le 30 septembre 2026 : build Angular/SSR (24 routes),
TypeScript et 22 scénarios Playwright réussis, dont six propres aux sauvegardes.
Les recettes FR/EN à 390 et 1440 px couvrent synthèse, navigation, guides,
historique réduit/étendu, preuves, réponse perdue, observation périmée et fermeture
des détails après retrait des accès. Aucun débordement horizontal ni violation
Axe sur les surfaces testées; focus clavier et retour après fermeture vérifiés.
Les API sont interceptées avec des données synthétiques. Lint sans erreur,
format ciblé et diff vérifiés; les écarts préexistants ci-dessus subsistent.
