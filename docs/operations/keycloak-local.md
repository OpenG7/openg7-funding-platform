# Keycloak en développement local sous Windows et Docker

Ce guide démarre le fournisseur Keycloak réel, son PostgreSQL privé et OpenG7
sur une machine Windows avec Docker Desktop. L'application utilise
`https://localhost` et l'identité `https://auth.openg7.test`. HTTPS, MFA, PKCE,
contrôle des rôles et révocation des sessions restent actifs.

Pour un VPS, suivre [Keycloak en production](keycloak-vps.md), avec DNS public,
Let's Encrypt et qualification de la cible. Les certificats mkcert et la
surcharge locale décrits ici appartiennent uniquement au développement.
Les [tests d'identité](admin-identity-and-alerts.md#recette-des-accès-administrateurs)
avec un fournisseur OIDC simulé ne remplacent pas ce démarrage Keycloak.

## 1. Préparer la machine et la cible locale

Utiliser Node.js 22 ou plus, Yarn 4 via Corepack, Docker Desktop en mode
conteneurs Linux et Docker Compose **2.24.4 ou plus** pour la surcharge de ports.
Depuis la racine du dépôt, dans
PowerShell :

```powershell
node --version
docker version
docker compose version
corepack enable
yarn install --immutable
```

Choisir un projet Compose local dédié. Si la pile existe déjà, conserver son
nom de projet, ses noms de volumes et ses identifiants PostgreSQL. Les étapes
d'initialisation ci-dessous concernent une **DB Funding neuve** ; pour une base
existante, suivre les [migrations et l'adoption de son historique](database-migrations.md).

Le nom de projet ne suffit pas à isoler les ressources : le Compose de base
donne des noms globaux aux volumes Funding et aux réseaux. Pour une pile
**neuve dédiée**, utiliser des noms uniques dans `.env`, par exemple :

```env
COMPOSE_PROJECT_NAME=openg7-keycloak-local
POSTGRES_VOLUME_NAME=openg7-keycloak-local-postgres
SPONSOR_LOGOS_VOLUME_NAME=openg7-keycloak-local-sponsor-logos
OPENG7_EDGE_NETWORK_NAME=openg7-keycloak-local-edge
OPENG7_DATA_NETWORK_NAME=openg7-keycloak-local-data
```

Conserver ces noms aux redémarrages. La DB et le réseau identités utilisent
le préfixe du projet Compose. Ne pas appliquer ces exemples à une pile existante
dont les volumes doivent être conservés.

Préparer `.env` à partir de [.env.example](../../.env.example) seulement s'il
n'existe pas encore. Garder ce fichier privé et hors Git. Modifier uniquement
les paramètres locaux nécessaires ; ne pas remplacer les secrets existants.
Les variables déjà définies dans le terminal priment sur `.env` : vérifier leur
origine si le préflight ne reconnaît pas la configuration attendue, sans
afficher leurs valeurs privées.

## 2. Configurer OIDC et les bases privées

Renseigner ces paramètres publics dans `.env` :

```env
FUNDING_PLATFORM_ENV=development
ANGULAR_CONFIGURATION=development
FUNDING_KEYCLOAK_ENABLED=true
FUNDING_KEYCLOAK_HOSTNAME=auth.openg7.test
FUNDING_ADMIN_AUTH_MODE=oidc
FUNDING_PUBLIC_BASE_URL=https://localhost
FUNDING_PLATFORM_API_BASE_URL=https://localhost/api
FUNDING_ALLOWED_ORIGINS=https://localhost,https://127.0.0.1
FUNDING_ADMIN_OIDC_ISSUER=https://auth.openg7.test/realms/openg7
FUNDING_ADMIN_OIDC_CLIENT_ID=openg7-funding-admin
FUNDING_ADMIN_OIDC_MFA_ACR=
FUNDING_ADMIN_OIDC_OWNER_SUBJECTS=
FUNDING_KEYCLOAK_BOOTSTRAP_ADMIN_USERNAME=keycloak-local-bootstrap
SMTP_ENABLED=false
FUNDING_EMAIL_WORKER_ENABLED=false
SOCIAL_PUBLICATION_WORKER_ENABLED=false
```

La liste des propriétaires reste vide pendant la création des personnes chez
Keycloak ; elle doit être renseignée avant le premier démarrage de l'API sur
une DB neuve. Le callback importé sera exactement
`https://localhost/api/admin/auth/callback`, sans wildcard.

Créer dans un gestionnaire de mots de passe trois secrets aléatoires distincts
d'au moins 32 caractères et les enregistrer uniquement dans `.env` protégé :
`FUNDING_KEYCLOAK_DB_PASSWORD`, `FUNDING_KEYCLOAK_BOOTSTRAP_ADMIN_PASSWORD` et
`FUNDING_ADMIN_OIDC_CLIENT_SECRET`. Ne pas les imprimer dans un terminal ou une
preuve de recette. Le compte bootstrap sert à administrer Keycloak, pas à
ouvrir une session propriétaire OpenG7.

La DB Keycloak est `identity-postgres`, indépendante de la DB Funding
`postgres`. Préparer également `POSTGRES_DB`, `POSTGRES_USER` et
`POSTGRES_PASSWORD`, puis les deux variables `FUNDING_DATABASE_RUNTIME_*` et
`DATABASE_URL` selon le [compte PostgreSQL applicatif](../docker-deployment.md#compte-postgresql-applicatif).
L'URL PostgreSQL de l'API doit viser le compte runtime sur `postgres:5432`, jamais la DB identité.
Le mot de passe runtime doit être distinct du mot de passe propriétaire ;
encoder les caractères réservés dans l'URL. Aucun port PostgreSQL n'est publié.

Cette recette d'identité n'utilise ni paiement ni livraison externe. Garder
les trois workers ci-dessus désactivés, surtout si `.env` contient déjà une
configuration SMTP ou de publication. Si Checkout est aussi configuré,
utiliser uniquement une `STRIPE_SECRET_KEY` de **test**. Elle n'est pas requise
pour démarrer l'API en développement sans Checkout.

Pour conserver des données privées, préparer
`FUNDING_PRIVATE_DATA_ENCRYPTION_KEY` avec exactement 32 octets aléatoires en
base64 standard et une copie protégée. La clé est obligatoire en production ;
ne pas recopier des valeurs de production dans cette configuration locale.
Les paramètres du mode token ne sont pas utilisés en OIDC et une
panne du fournisseur ne provoque aucun retour automatique à ce mode.

Ne pas définir `COMPOSE_FILE` pour le profil géré. `FUNDING_PLATFORM_ENV=development`
désigne la cible locale même si l'image API utilise `NODE_ENV=production`.
Conserver les paramètres OIDC ci-dessus dans `.env` pour les commandes
`keycloak:check`, `docker:recreate`, `docker:update` et TLS : elles lisent
`.env`/shell et ne mémorisent pas le dernier choix du lanceur.

En terminal interactif, `yarn docker:up:dev` propose `token`, `keycloak`, `oidc` ou
`configured` ; Entrée et `configured` conservent le mode configuré. Sans terminal
ou en `--dry-run`, aucune question d'authentification n'est posée. Pour imposer
Keycloak au démarrage, utiliser `yarn docker:up:dev:keycloak` ou
`yarn docker:up:dev --auth keycloak`. Le mode `token` reste réservé au
développement ; les choix de production Keycloak/OIDC sont décrits dans le
[guide VPS](keycloak-vps.md#configuration-et-démarrage-séparé) et conservent
les domaines publics préparés. L'option `--auth` vaut uniquement pour cette
invocation et ne modifie pas `.env`. Un choix explicite `token`, `keycloak` ou
`oidc` refuse un `COMPOSE_FILE` personnalisé ;
`configured` ou l'absence de choix conserve ce modèle.
Le choix `oidc` conserve la configuration du fournisseur externe existant et
désactive la surcharge Keycloak pour cette invocation.

Le choix Keycloak fixe l'hôte `auth.openg7.test`, l'origine `https://localhost`,
l'issuer HTTPS de ce guide et `FUNDING_ADMIN_OIDC_MFA_ACR` vide. Il garde les
secrets existants et les noms de client/bootstrap configurés, avec les valeurs
par défaut `openg7-funding-admin` et `keycloak-local-bootstrap` si ces noms sont
absents. Le sélecteur ne génère aucun secret et ne crée pas de compte OpenG7.
Vérifier le plan sans démarrer Docker ni le relais Stripe :

```powershell
yarn docker:up:dev:keycloak --no-stripe-webhook --dry-run
```

Ce plan inclut les surcharges identité et TLS, même si les certificats sont
absents. `--dry-run` annonce la préparation TLS nécessaire sans installer mkcert,
modifier la confiance Windows, générer des fichiers ou démarrer les services.

## 3. Préparer la résolution et HTTPS

Dans le fichier hosts Windows
`C:\Windows\System32\drivers\etc\hosts`, avec un éditeur lancé en administrateur,
ajouter l'entrée suivante si elle n'existe pas :

```text
127.0.0.1 auth.openg7.test
```

Cette modification est locale et manuelle ; aucun script du dépôt ne l'effectue.
Le navigateur doit résoudre l'hôte d'identité vers la machine qui expose
Traefik. Ne pas créer d'enregistrement DNS public pour `.test`.

Lors d'un démarrage Keycloak local, le lanceur valide le certificat serveur,
sa clé et la CA publique, y compris leurs dates de validité. Si les fichiers sont
absents, invalides ou expirés, il lance
`node scripts/setup-local-tls.mjs --renew --no-restart` avec la configuration
effective de l'alias, même si `.env` sélectionne un autre mode. Il revalide ensuite
les certificats, prépare les fichiers Traefik locaux et démarre Docker uniquement
si cette préparation réussit. Les certificats valides sont conservés.
Si le setup automatique change la CA publique, le lanceur arrête uniquement
`api` après le build et avant `up -d --wait` pour que Node recharge la CA ; une
CA inchangée ne déclenche pas cet arrêt.
Cette préparation automatique exclut token, OIDC externe et production ; elle
ne crée ni secrets, entrée hosts, comptes ni OTP.

Pour ce premier démarrage, préparer HTTPS séparément afin de démarrer le
fournisseur seul avant l'application aux étapes suivantes :

```powershell
yarn tls:local:setup --renew --no-restart
node scripts/prepare-local-identity.mjs
yarn keycloak:check
```

Le setup TLS peut installer mkcert avec winget et demander l'approbation de sa
CA dans Windows. Il génère un certificat pour `localhost`, `127.0.0.1`, `::1`
et `auth.openg7.test`, puis copie seulement le certificat public de la CA dans
`traefik/certs/rootCA.pem`. Le préparateur vérifie les certificats et génère les
fichiers locaux `traefik/local/traefik.yml`, `dynamic.yml` et `keycloak.yml`.
Ces fichiers et les certificats sont ignorés par Git.

La [surcharge locale](../../docker-compose.identity.local.yml) remplace la
configuration Traefik nécessaire au profil local, conserve HTTPS et évite ACME
pour les hôtes locaux. Elle publie Traefik uniquement sur `127.0.0.1` : HTTP,
HTTPS TCP/UDP et dashboard, avec HTTPS local accessible en IPv4.
Son alias réseau `auth.openg7.test` permet à l'API de
joindre Traefik depuis Docker. Elle monte uniquement la CA publique dans l'API
avec `NODE_EXTRA_CA_CERTS=/certs/rootCA.pem` ; la confiance installée dans Windows
ne suffit pas au processus Node du conteneur. La variable est lue au lancement
de Node : si la CA a été modifiée manuellement avant l'invocation du lanceur,
recréer l'API et le Web avec
`yarn docker:recreate`, qui conserve les surcharges et le profil HTTPS local.
[Documentation Node](https://github.com/nodejs/node/blob/v22.x/doc/api/cli.md#node_extra_ca_certsfile)

La clé `rootCA-key.pem` reste dans le magasin mkcert de la machine, sans copie
dans le dépôt ou un conteneur. La clé du certificat serveur est montée uniquement
dans Traefik. Ne pas désactiver la vérification TLS pour contourner un échec.

## 4. Démarrer Keycloak avant l'application

Définir une fois les fichiers Compose pour les commandes manuelles de ce guide :

```powershell
$identityCompose = @(
  '--env-file', '.env',
  '-f', 'docker-compose.yml',
  '-f', 'docker-compose.local-tls.yml',
  '-f', 'docker-compose.identity.yml',
  '-f', 'docker-compose.identity.local.yml'
)
docker compose @identityCompose config --quiet
docker compose @identityCompose build keycloak
docker compose @identityCompose up -d --wait identity-postgres keycloak traefik
docker compose @identityCompose ps identity-postgres keycloak traefik
```

Si le surveillant d'opérations est activé, ajouter son fichier
`docker-compose.operations.yml` après `docker-compose.local-tls.yml` et avant
`docker-compose.identity.yml`. Conserver le même projet et les mêmes fichiers
lors des commandes suivantes. La validation `config --quiet` n'affiche pas les
secrets interpolés ; ne pas utiliser sa variante avec sortie complète.

Keycloak démarre avec `start --optimized --import-realm`, sa DB dédiée et les
contrôles de santé du profil canonique. Les ports 8080, 9000 et 5432 restent
internes. L'API et le Web peuvent rester arrêtés pendant la préparation des
comptes.

Vérifier le certificat et la discovery sans exception TLS :

```powershell
$discovery = Invoke-RestMethod 'https://auth.openg7.test/realms/openg7/.well-known/openid-configuration'
$discovery.issuer
```

L'issuer attendu est `https://auth.openg7.test/realms/openg7`. Le realm `openg7`
et son client confidentiel sont importés, sans création d'utilisateur OpenG7.
Un realm déjà présent est conservé : une modification du JSON Git ou d'un
secret dans `.env` ne met pas à jour automatiquement son client existant.
Réconcilier la configuration dans la console avant de redémarrer, sans effacer
la DB identité ni forcer un réimport.

## 5. Créer les personnes et enrôler OTP

Ouvrir `https://auth.openg7.test/admin/` avec l'administrateur bootstrap du
realm `master`. Créer un administrateur Keycloak nominatif, lui attribuer les
droits nécessaires et vérifier son OTP avant de retirer le compte temporaire.
Les variables bootstrap restent requises par Compose ; elles ne recréent pas
le compte supprimé dans un realm existant.

Dans le realm **openg7**, créer le premier utilisateur OpenG7 et son mot de
passe propre. Lui demander l'action **Configure OTP**, puis ouvrir sa console
de compte `https://auth.openg7.test/realms/openg7/account/` pour enrôler un
authentificateur. Faire ensuite une nouvelle connexion complète mot de passe
et OTP : le seul enrôlement ne prouve pas le MFA du token courant.

Le flow importé `openg7-password-otp` et son mapper natif produisent `amr`
contenant `mfa` à partir des facteurs exécutés. Garder
`FUNDING_ADMIN_OIDC_MFA_ACR` vide ; ne pas remplacer cette preuve par un claim
constant ni désactiver OTP. Les rôles Keycloak ne donnent aucun rôle OpenG7.

Relever le **User ID** UUID dans la fiche de l'utilisateur du realm `openg7` :
il est son `sub` dans ce profil. Renseigner cet UUID dans
`FUNDING_ADMIN_OIDC_OWNER_SUBJECTS`, ou plusieurs UUID séparés par des virgules.
Un email, un nom d'utilisateur et le compte bootstrap `master` ne conviennent
pas. Garder ces identifiants dans la configuration privée. Sur DB neuve, l'API
créera le compte propriétaire à sa première connexion MFA réussie.

## 6. Initialiser la DB Funding et démarrer OpenG7

Pour une **DB neuve dédiée**, les exemples suivants supposent
`POSTGRES_DB=openg7_funding` et
`FUNDING_DATABASE_RUNTIME_USER=openg7_funding_api`. Adapter les deux confirmations
si ces noms diffèrent :

```powershell
docker compose @identityCompose --profile database up -d --wait postgres
node scripts/db-runtime-role.mjs --plan
node scripts/db-runtime-role.mjs --apply --confirm-database openg7_funding --confirm-role openg7_funding_api
yarn db:migrate
yarn keycloak:check
yarn docker:up:dev:keycloak --no-stripe-webhook
```

Le provisionnement crée d'abord le rôle runtime sur le schéma vide. Les
migrations complètes s'exécutent ensuite avec le propriétaire et réappliquent
les droits sur les tables nouvelles. Si le rôle runtime est configuré mais
n'existe pas encore, une migration peut échouer lors de l'application des droits.
Les scripts DB ciblent uniquement `postgres` du même projet ; ils ne démarrent
ni ne retirent Keycloak ou Traefik. Ne pas appliquer cette initialisation à une
base existante sans suivre son [historique de migrations](database-migrations.md).

Les diagnostics ne prouvent ni le MFA ni la connexion au fournisseur. Le
lanceur local vérifie les certificats et les prépare si nécessaire selon
l'étape HTTPS, puis construit la pile et attend les services ; il
**ne lance pas les migrations**. L'option `--no-stripe-webhook`
laisse le relais Stripe arrêté pour cette configuration d'identité.
Le diagnostic global `node scripts/services-check.mjs` est facultatif ici :
il peut signaler Stripe ou SMTP absents comme des erreurs alors que ces
fournisseurs sont volontairement inutilisés par cette recette.

Ouvrir `https://localhost/admin/login`, choisir la connexion OIDC et se
connecter avec la personne du realm `openg7`, mot de passe puis OTP. Vérifier
le rôle propriétaire et le diagnostic
`/admin/fundraiser/setup?section=identity`. Depuis **Accès et sessions**, ajouter
les autres subjects et leurs rôles selon le [runbook des accès](admin-identity-and-alerts.md).
Vérifier le refus d'une mutation réservée au propriétaire avec un lecteur.

## 7. Vérifier les sessions et conserver les données

L'API crée une session OpenG7 d'une heure, stockée dans la DB Funding avec
expiration et révocation, et pose un cookie HttpOnly/Secure. Keycloak conserve
séparément ses sessions SSO dans la DB identité. Vérifier la déconnexion puis
une reconnexion, et la révocation d'une session depuis **Accès et sessions** :
la prochaine requête administrative doit être refusée et les données privées
retirées de la page. Une révocation ne retire pas rétroactivement une opération
déjà autorisée côté serveur.

La déconnexion OpenG7 ne ferme pas la session globale Keycloak. Pour terminer
une session du fournisseur, utiliser la console de compte ou l'administration
Keycloak. Modifier un compte OpenG7 ferme ses sessions applicatives ; modifier
uniquement Keycloak ne constitue pas une révocation des sessions OpenG7 déjà
émises. Les deux vérifications sont distinctes.

Arrêter tous les services du modèle sélectionné, y compris `operations` s'il
est activé, sans supprimer les volumes :

```powershell
docker compose @identityCompose --profile database stop
```

Une fois la pile préparée, conserver certificats, hosts, comptes, OTP,
propriétaires, rôle runtime et historique des migrations. Ces initialisations
ne se répètent pas à chaque démarrage. Redémarrer avec le même alias Keycloak,
qui applique le choix pour cette invocation et renouvelle les certificats
uniquement s'ils sont absents, invalides ou expirés :

```powershell
yarn docker:up:dev:keycloak --no-stripe-webhook
docker compose @identityCompose --profile database ps
```

Pour démarrer temporairement l'application en token, utiliser
`yarn docker:up:dev:token --no-stripe-webhook` avec les secrets token locaux
déjà configurés. La surcharge identité est exclue, mais ses anciens conteneurs
peuvent rester actifs ; ce choix ne les arrête pas et ne supprime aucune DB ni
aucun volume. Reprendre l'alias `:keycloak` pour revenir à ce profil. Chaque choix
reste limité à son invocation ; `.env` est inchangé.

Conserver `.env`, les noms de projet/volumes et les deux bases. Ne pas utiliser
`down -v` pour un redémarrage. Les utilisateurs, OTP, rôles et sessions persistent
selon leurs expirations et révocations. Une sauvegarde applicative ne capture
pas automatiquement la DB Keycloak ; voir la
[sauvegarde identité séparée](keycloak-vps.md#sauvegarde-identite) avant une
évolution ou une récupération de données importantes.

Pour actualiser une pile existante sans relais Stripe ni élagage d'images :

```powershell
node scripts/docker-update.mjs --development --database --no-prune-images --no-stripe-webhook
```

Ce lanceur prépare et conserve les variantes locales, l'alias et la CA publique
selon `.env`/shell, pas selon le choix `--auth` d'une invocation précédente.
Le raccourci `yarn docker:update:dev` impose le relais Stripe et l'élagage ;
il ne convient donc pas à cette recette d'identité seule. Le renouvellement TLS
et son redémarrage conservent les surcharges identités et opérations activées
dans `.env`/shell. Le préflight `keycloak:check` et `docker:recreate` suivent
également cette configuration persistante.

## Dépannage et limites des preuves

| Symptôme                                                 | Vérification et reprise                                                                                                                                |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `auth.openg7.test` introuvable dans le navigateur        | Vérifier l'entrée hosts Windows et les ports HTTPS de Docker Desktop.                                                                                  |
| Certificat refusé ou hôte absent des SAN                 | Relancer le setup TLS avec `--renew --no-restart`, vérifier la CA Windows, puis le préparateur et la pile locale. Ne pas ignorer TLS.                  |
| Discovery fonctionne dans Windows mais échoue dans l'API | Vérifier alias Docker, montage du `rootCA.pem` public et `NODE_EXTRA_CA_CERTS`; recréer l'API après modification.                                      |
| Surcharge locale refusée                                 | Vérifier plateforme `development`, hôte `auth.openg7.test`, origine `https://localhost`, issuer exact, secrets distincts et absence de `COMPOSE_FILE`. |
| Retour OIDC refusé après changement de secret/callback   | Comparer le client existant du realm avec la configuration attendue ; l'import ne met pas à jour un realm existant.                                    |
| Connexion refusée après Configure OTP                    | Ouvrir une nouvelle connexion complète mot de passe + OTP, puis vérifier le User ID propriétaire. Ne pas afficher l'ID token.                          |
| API arrêtée ou propriétaire inconnu                      | Vérifier migrations complètes, rôle runtime, URL DB Funding, subjects et prérequis des fonctionnalités activées avant de relancer.                     |
| Refus 401 après expiration/révocation                    | Revenir à la connexion ; vérifier séparément la session OpenG7 et la session SSO fournisseur. Aucun retour automatique au token.                       |

Les fichiers et diagnostics prouvent une préparation, pas une connexion réelle.
Une validation complète relève séparément HTTPS navigateur/API, discovery,
mot de passe + OTP, rôle propriétaire, refus du lecteur et révocation. Les
recettes doivent utiliser des identités et des données synthétiques sur une
pile jetable, sans réutiliser la base de développement.

## Recette HTTPS jetable reproductible

Le [test HTTPS local](../../tests/identity/keycloak-local-https.integration.mjs)
utilise les quatre fichiers Compose du guide, une API et un Web réels, Keycloak,
Traefik et deux PostgreSQL privés. Il demande Node.js `>=22`, Docker local en
mode Linux avec Compose `>=2.24.4`, Chromium installé par Playwright et une CA
mkcert **déjà approuvée** par le navigateur de la machine. Il ne fait jamais
`mkcert -install` et ne modifie ni hosts Windows ni `.env` du dépôt.

Depuis la racine, construire les trois images avec leurs Dockerfiles officiels :

```powershell
docker build -f apps/funding-api/Dockerfile -t openg7-keycloak-local-validation-api:test .
docker build -f Dockerfile --build-arg ANGULAR_CONFIGURATION=production -t openg7-keycloak-local-validation-web:test .
docker build -f docker/keycloak/Dockerfile -t openg7-keycloak:26.8.0-local .
```

Si les images PostgreSQL ou Traefik ne sont pas déjà disponibles localement :

```powershell
docker pull postgres:16-alpine
docker pull traefik:v3.7.13
```

Installer Chromium correspondant au Playwright du lockfile, puis lancer la recette :

```powershell
yarn exec playwright install chromium
node --test tests/identity/keycloak-local-https.integration.mjs
```

Ces images sont les valeurs par défaut du [helper de pile](../../tests/identity/keycloak-local-https-stack.mjs).
Le test refuse un daemon Docker distant. Si mkcert est installé ailleurs que
le chemin winget attendu, `OPENG7_TEST_MKCERT` peut désigner son exécutable local.
Le helper génère un certificat dans un répertoire temporaire avec la CA
existante et copie uniquement son certificat public ; sa clé privée reste dans
le magasin mkcert. La résolution `auth.openg7.test` est adaptée seulement dans
le processus Chromium, vers un port HTTPS temporaire sur `127.0.0.1`.
L'API conserve l'alias Docker et la confiance CA du profil local.

La pile crée des noms de projet et de ressources uniques, des identités et
secrets synthétiques, et deux DB en tmpfs sans port publié. Le nettoyage retire
uniquement cette pile et son répertoire temporaire, jamais les volumes de
développement. Aucun paiement ni livraison externe n'est exécuté.

Le scénario vérifie l'enrôlement OTP avec refus du premier callback sans MFA,
le refus d'un OTP incorrect, puis la connexion propriétaire après MFA. Il
contrôle le cookie HttpOnly/Secure, le hash de session dans PostgreSQL,
l'audit, la conservation de la même session après redémarrage de l'API et sa
révocation avec refus 401. Il ne teste pas la création manuelle des comptes dans
la console `master`, les wrappers CLI de provisionnement/migrations, le refus
du lecteur ni la conservation des DB après leur redémarrage ; ces étapes
restent à vérifier séparément. Cette recette locale ne qualifie aucun VPS.

<a id="preuve-https-locale"></a>

### Preuve du 8 octobre 2026

Sous Windows avec Docker Desktop Linux, Node.js **22.23.3** et Chromium de
Playwright **1.61.1**, la commande `node --test tests/identity/keycloak-local-https.integration.mjs`
a réussi : **1/1**, environ 187 secondes sur la version finale. Les images API et Web ont été
construites avec les Dockerfiles ci-dessus, sous les tags `:20261008`, choisis
par `OPENG7_TEST_KEYCLOAK_API_IMAGE` et `OPENG7_TEST_KEYCLOAK_WEB_IMAGE`.

Les six services réels ont validé le certificat approuvé, l'issuer HTTPS et
le realm avec `sslRequired=all`. L'enrôlement initial et l'OTP incorrect n'ont
créé aucune session ; le mot de passe puis l'OTP correct ont ouvert une session
propriétaire avec cookie Secure/HttpOnly/SameSite et hash stocké en DB.
Le registre contient toutes les migrations et l'API utilise un rôle runtime
distinct. La même session fonctionne après redémarrage de l'API. L'annulation
de révocation la conserve, puis sa confirmation est auditée et l'ancien cookie
reçoit 401. Le nettoyage n'a laissé aucun conteneur de cette recette.

Les **58 tests ciblés de configuration** et les **6 tests Keycloak isolés** ont
également réussi. Cette preuve porte sur la pile locale jetable ; les limites
et vérifications manuelles ci-dessus restent applicables.

La [recette Keycloak isolée](keycloak-vps.md#preuves-et-travail-restant) teste
l'image réelle avec une exception HTTP réservée au test et une persistance API
injectée en mémoire ; les tests OIDC signés utilisent un fournisseur simulé.
Ces scénarios ont une portée différente de la recette HTTPS ci-dessus. Le
[runbook de production](keycloak-vps.md#verifications-avant-activation) conserve
ses vérifications DNS/HTTPS/MFA, capacité, sauvegarde et restauration.
