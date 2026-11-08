# Activation locale de la galerie intelligente

Activation de développement réalisée le **5 novembre 2026 à 22 h 43,
America/Toronto** (6 novembre à 03 h 43 UTC), pour
`C:\GitHub\openg7-funding-platform` et `https://localhost`.
**065/066 sont appliquées, l’API est saine sur l’image revue et le quota photos
est vingt.** Seule l’API a été recréée, après sauvegarde DB chiffrée et
restauration vérifiée sur PostgreSQL jetable. Le Web de développement a ensuite
compilé et son routage HTTPS a été vérifié. Les étapes et résultats exécutés
sont consignés ci-dessous ; les procédures de reprise restent disponibles.

Le [socle du dépôt](../../AGENTS.md#garde-fous) précise qu’« une demande de code
n’autorise pas une opération de production, un envoi externe, une publication ou
une destruction de données ». Ici, même la pile de développement est raccordée
à SMTP et au stockage OVH. La mise à jour de cette pile de développement a été
réalisée après les validations du code, la sauvegarde vérifiée et les contrôles
opérationnels ci-dessous. Elle a conservé les automatismes existants, sans déclencher de
commande d’envoi, d’import, d’export, d’approbation ou de publication.

## État vérifié

Le conteneur API actuel est sain, en environnement Funding `development`, avec
OIDC/Keycloak. La cible PostgreSQL du runner correspond à celle de l’API et au
conteneur PostgreSQL privé du projet Compose `openg7-funding-platform`.

Le plan initial avait identifié **001 à 064 conformes et 065/066 en attente**.
Après arrêt de l’API, le runner canonique a appliqué uniquement **065 et 066**.
Le second `node scripts/db-migrate.mjs --plan` ne relève plus de migration en
attente ; une lecture du registre a confirmé le numéro maximal **66**.

| Configuration effective du conteneur actuel   | État constaté                                                                 |
| --------------------------------------------- | ----------------------------------------------------------------------------- |
| SMTP / traitement de la file de courriels     | Activés                                                                       |
| Rappels administratifs de revue               | Activés                                                                       |
| Courriel de contribution / SMS                | Désactivé / désactivé                                                         |
| Publication sociale                           | Mode `disabled`, défaut du worker `false`, réglage persistant effectif `true` |
| Observation HTTP de visibilité / assistant IA | Désactivés                                                                    |
| Stockage des médias                           | `ovh-s3`                                                                      |
| Nombre maximal de photos de présentation      | **20**, entrée persistée dans `.env`                                          |
| Clé Stripe                                    | Famille test ; aucune valeur affichée                                         |
| Preflight producteur                          | `PREFLIGHT_ENABLED=false`                                                     |
| Inbox / recette Preflight locale              | Activées dans le conteneur actuel                                             |

La clé de quota était absente du `.env` initial ; Compose appliquait son défaut
de trois photos. Après chiffrement et vérification du fichier original, la
seule entrée `FUNDING_SPONSOR_MEDIA_MAX_SUPPORTING_IMAGES=20` a été ajoutée.
Le fichier entier a été comparé avant écriture sous verrou exclusif ; tous les
octets existants et leur convention de fin de ligne ont été conservés. La
comparaison de l’environnement runtime avant/après ne relève que ce delta
**3 → 20**. Aucun média n’a été créé pour exercer ce quota.

Aucun `FUNDING_DATABASE_RUNTIME_USER` n’est actuellement configuré pour le runner.
L’API de développement utilise le même utilisateur que le propriétaire de
migrations. Ne pas présenter cet état comme un rôle API limité. Le passage à un
rôle dédié serait une opération distincte suivant le
[runbook PostgreSQL](../docker-deployment.md#compte-postgresql-applicatif).

## Gardes et automatismes conservés

Le [démarrage des tâches API](../../apps/funding-api/src/api-background-workers.ts)
appelle immédiatement le traitement des courriels et les rappels, puis les
reprogramme. Il lance aussi les analyses locales, l’assistance à la préparation,
l’activité des contributions et les traitements médias persistants.

Le [nettoyage média](../../apps/funding-api/src/sponsor-media-workspace/cleanup.ts)
peut reprendre des travaux existants et supprimer leurs objets privés/publics
dans le stockage configuré. Aucun interrupteur d’environnement général ne
désactive ce nettoyage dans l’implémentation actuelle. Désactiver SMTP seul ne
neutralise donc pas tous les effets possibles d’un redémarrage.

### Compteurs opérationnels effectivement lus

Relevé préparatoire du **5 novembre 2026 à 21 h 56–21 h 57, America/Toronto**
(02 h 56–02 h 57 UTC le lendemain). La cible locale a été vérifiée à nouveau
contre l’API et le conteneur PostgreSQL, puis les seules agrégations ci-dessous
ont été exécutées dans des transactions `REPEATABLE READ READ ONLY`, avec
`transaction_read_only=on`, délai de requête borné et fin par `ROLLBACK`.
Aucun claim, curseur, reçu, date ou job n’a été modifié. Aucun destinataire,
corps de courriel, dossier identifiable ou chemin d’objet n’a été sorti.

| État opérationnel                                                              | Résultat                                  |
| ------------------------------------------------------------------------------ | ----------------------------------------- |
| Nettoyages médias `pending` / éligibles / sous bail / bail expiré / en reprise | **0 / 0 / 0 / 0 / 0**                     |
| Courriels éligibles selon le claim natif                                       | **0**                                     |
| Courriels `queued` / `sending` / envoi expiré / reprise future éligible        | **0 / 0 / 0 / 0**                         |
| Courriels `failed` ayant épuisé leurs tentatives                               | **5**                                     |
| Courriels `uncertain`, exclus du claim automatique                             | **1**                                     |
| Worker social persistant                                                       | **`enabled=true`, version 2**             |
| Flux sociaux en pause / total                                                  | **4 / 4**                                 |
| Flux avec préparation automatique / préparation actuellement due               | **4 / 0**                                 |
| Dossiers dus pour le rappel natif / dossiers examinés                          | **1 / 6**, plafond natif 2 000            |
| Seuil du rappel / destinataire administrateur configuré                        | **1 jour / oui**, aucune adresse affichée |
| Reçu du rappel pour le jour UTC courant                                        | **1, statut `sent`**                      |

Les critères d’éligibilité ont été repris des services propriétaires :
[nettoyage](../../apps/funding-api/src/sponsor-media-workspace/cleanup.ts),
[claim courriel](../../apps/funding-api/src/email-queue.repository.ts),
[rappel](../../apps/funding-api/src/admin-reminder.service.ts) et
[revue du dossier](../../apps/funding-api/src/sponsorship-review-policy.ts).
Le compte des rappels applique le même scan borné aux dossiers récents, la fiche
complète et la date de transmission ; il ne retourne pas leurs coordonnées.

À cet instant, **aucun envoi SMTP ni nettoyage OVH n’est immédiatement éligible**.
Les cinq échecs épuisés ne sont pas relancés automatiquement. Le courriel incertain
reste en quarantaine et nécessite une réconciliation distincte, sans retry aveugle.
Le rappel déjà envoyé est dédupliqué pour le jour UTC courant.

Le worker social persistant actif prime bien sur le défaut d’environnement
`false`. Ses quatre flux sont en pause et le fournisseur est `disabled` : aucun
envoi social n’est activé par ce relevé. La préparation privée automatique reste
active indépendamment de la pause, selon sa cadence native de cinq minutes.
Elle peut créer de nouvelles propositions privées ; elle ne constitue pas une
simple reprise de commandes humaines déjà confirmées et n’accorde aucune
autorisation de publication. De même, après changement du jour UTC, un dossier
toujours dû peut entraîner un nouveau rappel quotidien avec la configuration
existante. Ces automatismes sont déjà actifs dans l’API courante : le redémarrage
ne les introduit pas et ne change pas leurs réglages.

Ces lectures sont des instantanés, sans gel des écritures de l’application.
Relever à nouveau les compteurs juste avant une activation différée et qualifier
un effet réel apparu entre-temps plutôt que présumer qu’une file est vide ou
qu’un worker est arrêté.

Avant activation, examiner tout nouveau travail éligible et conserver les
résultats incertains. Une suspension d’envois ou de rappels, si nécessaire,
conserve leurs valeurs pour la reprise ; elle n’est pas déduite de la seule
présence de credentials. Si un nouveau relevé révèle un nettoyage OVH éligible,
réconcilier sa commande confirmée et sa reprise avant exécution, sans vider ses
jobs ni changer de pilote. Les affectations préparatoires et les demandes N1 de cette refonte
n’autorisent aucune publication ; les N1 groupées différeront explicitement les
notifications plutôt que de créer des courriels.

### Contrôles frais de l’activation

Juste avant l’arrêt de l’API, les agrégations en transaction de lecture seule
ont confirmé : zéro courriel éligible ou en cours, zéro job de nettoyage,
zéro publication, analyse ou assistance en cours, quatre flux sociaux en
pause et rappel quotidien déjà envoyé. Le fournisseur social était toujours
`disabled` ; aucun réglage de worker, horaire, pause ou consentement n’a changé.

Le contrôle du **6 novembre 2026 à 03 h 46 min 05 s UTC** a confirmé :

- API `healthy`, image revue, quota runtime **20**, registre **66**.
- `https://localhost/api/admin/auth/config` : **HTTP 200, mode `oidc`**, avec
  validation du certificat par la CA locale existante.
- Totaux des courriels et des jobs de nettoyage strictement identiques au
  relevé immédiatement avant arrêt : **aucune nouvelle ligne** dans ces files.
- Courriels éligibles/en cours et nettoyages en attente : **0 / 0 / 0** ;
  l’unique courriel incertain est conservé.
- Fournisseur social `disabled`, réglage persistant **`enabled=true`, version 2**,
  **4/4 flux en pause** et zéro publication en cours.

Avant le lancement Web, les identifiants et dates de démarrage des autres
conteneurs du projet ont été comparés au relevé initial : PostgreSQL, identité,
Keycloak, Traefik, Web Docker et supervision n’ont été ni recréés ni redémarrés
par l’activation API. Aucun seed ou provisionnement Keycloak n’a été lancé.

## Conserver les six couches Compose

Le conteneur existant a été créé avec ces fichiers, dans cet ordre :

```powershell
$fundingComposeOptions = @(
  '-p', 'openg7-funding-platform',
  '-f', 'docker-compose.yml',
  '-f', 'docker-compose.local-tls.yml',
  '-f', 'docker-compose.identity.yml',
  '-f', 'docker-compose.identity.local.yml',
  '-f', 'docker-compose.preflight-inbox.yml',
  '-f', 'docker-compose.preflight-rehearsal.yml'
)
```

Un `docker compose` sans ces options résout actuellement seulement la composition
de base. Il ne convient pas pour recréer l’API existante : il perdrait notamment
la CA locale et le montage/staging de l’identité technique Preflight.

La session relue ne définit pas `PREFLIGHT_CLIENT_SECRET_FILE`, alors que le
conteneur possède toujours le montage privé correspondant. Le fichier déjà
monté a été retrouvé et vérifié sans lire son contenu ni afficher son chemin.
L’activation a restauré les variables techniques du conteneur dans un
sous-processus privé, remplacé seulement ce chemin par sa source hôte existante,
conservé la valeur exacte de `FUNDING_PUBLIC_BASE_URL` déjà active, et sélectionné
l’image de revue avec le quota vingt. Les six couches passent `config --quiet`.

La comparaison de l’environnement complet cible/courant ne relève qu’un seul
delta métier : **quota photos 3 → 20**. La commande shell est identique après
normalisation de l’échappement Compose ; le staging privé et le mode `0400`
sont conservés. Seule l’entrée de quota décrite plus haut a été ajoutée au
`.env`. Les variables techniques sont transitoires : les reconstruire depuis
le conteneur courant pour une prochaine opération, puis comparer à nouveau,
sans sortir leurs valeurs.

## Procédure exécutée et commandes de référence

Ces commandes partent de la racine du dépôt, après les validations du changement.
Elles documentent cette activation ; une livraison ultérieure doit refaire
ses propres contrôles et ne les rejoue pas automatiquement.

### Préflight et sauvegarde vérifiée

Après avoir préparé les options Compose et les entrées protégées :

```powershell
git status --short
docker compose @fundingComposeOptions --profile database config --quiet
docker compose @fundingComposeOptions --profile database ps
node scripts/db-migrate.mjs --plan
```

`config --quiet` vérifie la composition sans afficher les secrets interpolés.
Conserver le projet et le service `postgres` vérifiés ; le runner ne déduit pas
sa cible de `DATABASE_URL`.

Identifier l’image API courante avant que le tag local ne soit reconstruit :

```powershell
$fundingPreviousApiImage = (
  docker inspect --format '{{.Image}}' openg7-funding-platform-api-1
).Trim()
```

Pour ce changement de schéma additif, une sauvegarde **DB seule** a été retenue :
aucun binaire média n’est modifié par 065/066 et aucun nettoyage n’était éligible
dans le relevé. Cela ne constitue pas une sauvegarde complète du stockage OVH.

La sauvegarde a été réalisée avec `pg_dump --format=custom --no-owner --no-acl`
du seul PostgreSQL local vérifié, sous un snapshot exporté en lecture seule.
Le dump clair est resté en mémoire ; seul son chiffrement **Windows DPAPI
CurrentUser** a été écrit dans un emplacement privé hors Git avec ACL limitée.
`age` et son destinataire n’étant pas configurés sur cet hôte, ils n’ont pas été
substitués ou installés. Le fichier chiffré durable et son manifeste privé sont
conservés ; son déchiffrement dépend du profil Windows CurrentUser utilisé.

- Taille chiffrée : **1 151 638 octets**.
- SHA-256 chiffré : `b601f8652ede96860b5def0477572013c752fb8aef9b78cda8a4017ebfcbb163`.
- Restauration réellement exécutée dans PostgreSQL 16 jetable, `--network none`,
  sans port publié, API ou worker.
- **91 tables, 21 965 lignes**, chaque compteur de table identique au même
  snapshot source ; registre de migrations au numéro **64**.
- Déchiffrement et restauration réussis ; seul le conteneur jetable créé pour
  cette vérification a été supprimé. Aucun dump clair temporaire n’a été créé.

Le `.env` original a également été conservé hors Git, chiffré avec DPAPI
CurrentUser et déchiffré en mémoire pour vérification, avant toute modification.
SHA-256 de cet artefact chiffré :
`4f576e9ef1fc2f8479c321756df2bf53a9c80f62fa69a303cdf4c0141f4eeaa5`.
Les deux sauvegardes durables et leur manifeste privé sont conservés ; leurs
chemins et contenus ne sont pas reproduits dans ce document.

Pour une sauvegarde complète distincte, le mécanisme existant reste :

```powershell
bash scripts/backup.sh
```

Elle exige Node, Bash et `age`, un destinataire public de chiffrement configuré,
un répertoire privé et l’accès aux objets S3. Elle capture base, configuration et
médias dans des artefacts chiffrés ; vérifier le manifeste d’intégrité et la
complétude, puis exercer la restauration sur une cible jetable selon le
[runbook de sauvegarde](../docker-deployment.md). Une sauvegarde DB seule ne
restaure pas les objets OVH. Cette commande n’a pas été lancée ici.

### Image API de revue déjà construite

```powershell
docker build -f apps/funding-api/Dockerfile -t openg7-funding-platform-api:preflight-gallery-review .
```

Cette commande a réussi : compilation du workspace sur la base Node **22.23.3**,
utilisateur runtime `node`, Linux amd64. L’image de revue est
`sha256:cbf644e671204363df8db32a7c4e2e506f0b74d3c0a980b0b96201c71524b46e`.
La construction n’a démarré aucun service. Les `.env`,
certificats et fichiers privés sont exclus du contexte Docker, notamment le
fichier Preflight situé sous le répertoire ignoré `var`.

La construction inclut les travaux déjà présents dans le workspace. Après les
validations, l’ancienne image a été conservée sous le tag de reprise
`openg7-funding-api:before-gallery-6ff696c0`, puis l’image revue a été promue
vers l’alias local courant. Ainsi, une future composition conserve ce code :

```powershell
docker tag sha256:86c3c495a21f19a86cb363d1a9adb311b75bc064bfe72e9e2091505a6ca93036 openg7-funding-api:before-gallery-6ff696c0
docker tag openg7-funding-platform-api:preflight-gallery-review openg7-funding-api:local
$env:API_IMAGE = 'openg7-funding-api:local'
```

L’alias et le conteneur recréé pointent tous deux vers l’identifiant revue
`cbf644e67120…`. L’image précédente reste disponible pour une reprise contrôlée.

### Migration et recréation réalisées

Après sauvegarde vérifiée, examen des tâches et validation de leurs effets,
arrêter uniquement l’API en laissant finir les opérations en cours :

```powershell
docker compose @fundingComposeOptions --profile database stop api
node scripts/db-migrate.mjs --plan
node scripts/db-migrate.mjs
node scripts/db-migrate.mjs --plan
docker compose @fundingComposeOptions --profile database up -d --no-deps --no-build --force-recreate api
docker compose @fundingComposeOptions --profile database ps api
```

Le runner normalise les fins de ligne pour ses empreintes, verrouille le registre,
vérifie le préfixe historique et applique uniquement les migrations manquantes
dans une transaction. Il refuse une empreinte historique différente. Utiliser
le répertoire complet des migrations, jamais un dossier temporaire contenant
seulement 065/066 ni des SQL historiques rejoués à la main.

065 crée les sessions privées de travail ; 066 crée les associations médias de
préparation. Aucune de ces migrations n’importe de fichiers ni n’approuve ou ne
publie un dossier. Si un rôle runtime dédié a été préparé et configuré entre-temps,
le runner actualise ses grants dans la même transaction. Les associations sont
mutables avec conservation de leur identité et des retraits ; les journaux restent
immuables. Les gardes de démarrage vérifient le schéma et ses droits.

`--no-deps` conserve PostgreSQL, Keycloak, Traefik et Web. Ne pas relancer le
provisionnement Keycloak ou le lanceur global pour cette livraison. Ne pas
recréer les volumes ni utiliser un seed de recette sur cette cible.

### Vérifications après activation

Vérifier la santé API, le maintien du TLS local et l’authentification existante.
Lire seulement les statuts et codes utiles, sans sortir de corps privés :

```powershell
docker compose @fundingComposeOptions exec -T api node -e "fetch('http://127.0.0.1:3333/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
```

Pour servir le nouveau Web avec la pile HTTPS existante, utiliser le
[lanceur de développement](keycloak-local.md#recompilation-web-avec-api-docker) :

```powershell
yarn dev:web:docker
```

Son port 4200 doit être libre ; après une interruption brutale antérieure,
réconcilier d’abord le routage avec `yarn dev:web:docker --restore`. La commande
ne remplace pas la migration ou la recréation API. Vérifier dans la session
autorisée la galerie du dossier, ses limites et la consultation dans Examiner.
Les mutations de dossiers réels et les téléchargements privés restent des
actions humaines explicites.

Pour cette activation, le lanceur Web a été démarré après le jalon API sain.
Compilation Angular de développement réussie en **12,1 s**, le 6 novembre à
**03 h 44 min 24 s UTC**. La lecture de `https://localhost/@vite/client` a
retourné **HTTP 200, `text/javascript`** ; l’authentification API est restée en
**HTTP 200 / `oidc`**. Le processus de développement reste actif pour la reprise
de l’utilisateur. Aucun dossier réel n’a été consulté ou modifié pour ces
vérifications d’exploitation.

## Reprise

Sur échec du runner ou résultat incertain, relire `--plan` et le registre avant
toute reprise. Un échec de transaction ne valide pas les migrations en attente.
Conserver les fichiers appliqués immuables et privilégier une correction en avant.

Sur échec de santé de la nouvelle API, garder les traitements suspendus,
identifier le code de garde sans journal privé brut et conserver l’ancienne
image. Revenir à une image précédente ne supprime pas 065/066, ne restaure pas
les données et ne doit pas réactiver les workers sans revue. L’ancien serveur
ignore les nouveaux parcours ; valider la compatibilité avant tout retour.
Aucune restauration de sauvegarde n’est implicite.

## Recette isolée disponible

Pour valider les nouveaux contrats sans raccorder l’API métier :

```powershell
yarn build
node --test tests/integration/sponsor-media-preparation.integration.mjs
node scripts/admin-acceptance.mjs tests/playwright/sponsorship-media-acceptance.spec.ts --project=chromium --grep 'approved media delete-photo:'
```

Le premier scénario utilise PostgreSQL temporaire et des octets synthétiques ;
il vérifie notamment les affectations, les conflits, la N1 sans courriel et
l’export privé. Le second runner crée son propre projet Compose avec un fichier
d’environnement vide, une base jetable et des fournisseurs simulés. Il ne
réutilise pas `.env`, la base ou les buckets métier ; son nettoyage reste borné
à son projet unique. Les captures du
[scénario UI de galerie](../../tests/playwright/admin-intelligent-media-gallery.ui.spec.ts)
utilisent également des dossiers et médias synthétiques. Ces preuves ne valent
pas activation de la pile existante ni livraison réelle à un fournisseur.
