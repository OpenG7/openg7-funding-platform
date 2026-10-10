# Production Docker, Traefik, Nginx and Let's Encrypt

This production stack is designed for the OVH VPS configured through `VPS_HOST` on Ubuntu 24.04 LTS.

For Windows/Docker development with the real OIDC provider, use the
[local Keycloak guide](operations/keycloak-local.md). Its trusted local HTTPS
profile is separate from this VPS procedure and its Let's Encrypt configuration.

The public application URL is:

```text
https://openg7.org
```

Stripe webhook URL:

```text
https://openg7.org/api/stripe/webhook
```

## Project Structure

```text
project/
├── .github/
│   └── workflows/
│       └── deploy.yml
├── apps/
│   ├── funding-api/
│   │   ├── Dockerfile
│   │   └── src/
│   └── funding-web/
│       ├── Dockerfile
│       ├── nginx.conf
│       └── src/
├── backups/
├── docs/
│   └── docker-deployment.md
├── packages/
├── scripts/
│   ├── backup.sh
│   ├── check.sh
│   ├── deploy.sh
│   ├── install-vps.sh
│   └── renew-certs.sh
├── traefik/
│   ├── acme/
│   │   └── .gitkeep
│   ├── dynamic.yml
│   └── traefik.yml
├── .dockerignore
├── .env
├── .env.example
├── Dockerfile
├── docker-compose.yml
├── package.json
└── yarn.lock
```

## Services

- `traefik`: public reverse proxy (3.7.13), HTTP to HTTPS redirect, Let's Encrypt, HTTP/2, HTTP/3, security headers, rate limits.
- `web`: Angular static app served by Nginx unprivileged.
- `api`: Node funding API for checkout, public transparency, and Stripe webhooks.
- `postgres`: private PostgreSQL 16 service, enabled by the `database` profile for persistent features.
- `operations`: optional independent alert watcher from `docker-compose.operations.yml`, managed by delivery after explicit opt-in.
- `keycloak` and `identity-postgres`: optional OIDC provider and separate private DB from `docker-compose.identity.yml`; see the [same-VPS identity runbook](operations/keycloak-vps.md) for explicit activation, MFA bootstrap, capacity and independent backup/recovery.
- `cadvisor`: local-only Docker metrics on `127.0.0.1:8082`.

## Environment

Create the real environment file:

```bash
cp .env.example .env
nano .env
chmod 600 .env
```

Production values:

```env
APP_DOMAIN=openg7.org
LETSENCRYPT_EMAIL=your-email@example.com
TRAEFIK_DASHBOARD_BIND=127.0.0.1:8081
CADVISOR_BIND=127.0.0.1:8082
WEB_IMAGE=openg7-funding-web:local
API_IMAGE=openg7-funding-api:local
FUNDING_PLATFORM_ENV=production
FUNDING_PLATFORM_API_BASE_URL=https://openg7.org/api
FUNDING_PUBLIC_BASE_URL=https://openg7.org
FUNDING_ALLOWED_ORIGINS=https://openg7.org,https://www.openg7.org
FUNDING_ALLOWED_AMOUNTS=5,10,25,50
FUNDING_BUSINESS_SPONSORSHIP_ENABLED=false
FUNDING_API_PORT=3333
FUNDING_PROJECT_ID=openg7
FUNDING_ADMIN_AUTH_MODE=oidc
FUNDING_ADMIN_TOKEN=
FUNDING_ADMIN_OIDC_ISSUER=https://identity.example.com
FUNDING_ADMIN_OIDC_CLIENT_ID=replace_with_configured_client_id
FUNDING_ADMIN_OIDC_CLIENT_SECRET=replace_with_configured_client_secret
FUNDING_ADMIN_OIDC_OWNER_SUBJECTS=replace_with_verified_owner_subject
FUNDING_ADMIN_OIDC_MFA_ACR=
FUNDING_PRIVATE_DATA_ENCRYPTION_KEY=replace_with_32_random_bytes_in_base64
SMTP_ENABLED=true
SMTP_HOST=mail.papamail.net
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=notify@openg7.org
SMTP_PASSWORD=replace_with_private_smtp_password
MAIL_FROM_NAME=OpenG7
MAIL_FROM_ADDRESS=notify@openg7.org
MAIL_REPLY_TO_NAME=OpenG7
MAIL_REPLY_TO_ADDRESS=contact@openg7.org
FUNDING_ADMIN_NOTIFICATION_EMAIL=contact@openg7.org
FUNDING_ADMIN_REVIEW_REMINDER_ENABLED=true
FUNDING_ADMIN_REVIEW_REMINDER_MIN_AGE_DAYS=1
FUNDING_ADMIN_REVIEW_REMINDER_POLL_INTERVAL_MS=3600000
FUNDING_ADMIN_REVIEW_REMINDER_MAX_ITEMS=5
SPONSOR_MEDIA_STORAGE_DRIVER=ovh-s3
FUNDING_SPONSOR_LOGO_STORAGE_DIR=/app/var/sponsor-logos
FUNDING_SPONSOR_LOGO_MAX_BYTES=524288
FUNDING_SPONSOR_MEDIA_MAX_BYTES=8388608
FUNDING_SPONSOR_MEDIA_MAX_SUPPORTING_IMAGES=3
SPONSOR_MEDIA_REGION=bhs
SPONSOR_MEDIA_ENDPOINT=https://s3.bhs.io.cloud.ovh.net
SPONSOR_MEDIA_PUBLIC_BUCKET=openg7-funding-sponsor-media-public-prod
SPONSOR_MEDIA_PUBLIC_BASE_URL=https://openg7-funding-sponsor-media-public-prod.s3.bhs.io.cloud.ovh.net
SPONSOR_MEDIA_PRIVATE_BUCKET=openg7-funding-sponsor-media-private-prod
SPONSOR_MEDIA_PRIVATE_BASE_URL=https://openg7-funding-sponsor-media-private-prod.s3.bhs.io.cloud.ovh.net
OVH_S3_ACCESS_KEY_ID=
OVH_S3_SECRET_ACCESS_KEY=
STRIPE_SECRET_KEY=sk_live_replace_me
STRIPE_WEBHOOK_SECRET=whsec_replace_me
# Private PostgreSQL is required for production administration and real Checkout.
# POSTGRES_DB=openg7_funding
# POSTGRES_USER=openg7_funding_owner
# POSTGRES_PASSWORD=replace_with_a_long_random_secret
# DATABASE_URL=postgres://openg7_funding_api:replace_with_a_different_long_random_secret@postgres:5432/openg7_funding
BACKUP_DIR=./backups
FUNDING_FULL_BACKUP_AGE_RECIPIENT=
```

Production requires named OIDC accounts and MFA. Legacy token authentication is
limited to local development/test. Configure the issuer, client, approved owner
subjects and the private-data encryption key (exactly 32 random bytes, standard base64)
before starting the API. Named OIDC accounts, MFA and
revocable sessions require PostgreSQL and the settings in the
[identity/alerts runbook](operations/admin-identity-and-alerts.md). OIDC requires
one public origin for Web and API. For the optional provider on this VPS, follow
the [Keycloak preparation and verification procedure](operations/keycloak-vps.md);
its startup and database recovery are separate from application delivery.
Set `FUNDING_OPERATIONS_WATCHER_ENABLED=true`
after qualifying the receiver to include the operations overlay in deploy,
health checks and rollback. It follows the selected API image revision.
`STRIPE_SECRET_KEY` is also required by the API startup checks; qualifying identity
does not require a live payment. Session signing secret and token TTL settings
apply only to local/test `token` mode, not OIDC. Because `deploy.sh` sources `.env`
in Bash, use literal assignments compatible with Bash and Compose, single quotes
for values containing `$` or spaces, and URL-encoded credentials in `DATABASE_URL`.

## First VPS Installation

Run on Ubuntu 24.04 LTS:

```bash
sudo apt-get update
sudo apt-get install -y git
git clone https://github.com/OpenG7/openg7-funding-platform.git
cd openg7-funding-platform
sudo bash scripts/install-vps.sh
cp .env.example .env
nano .env
chmod 600 .env
```

The installer prepares Docker, firewall and ACME storage; it does not install
Node/Yarn or start OpenG7. Ensure Node 22 and Corepack are available on the host
(see the [repository prerequisites](../README.md#quick-start)). From a workstation
with the workspace installed, `yarn vps:node:install` prepares Node/Corepack on
the configured VPS when missing; verify `node --version` reports 22.x and
`corepack --version` succeeds.
Before the first
application delivery, complete the [OIDC startup sequence](operations/keycloak-vps.md#premier-demarrage-oidc):
start identity alone, verify DNS/HTTPS and the realm, prepare named OTP accounts
and owner subjects, then migrate the separate Funding database and provision its
restricted runtime role. For another provider, meet the same application
prerequisites using the [identity runbook](operations/admin-identity-and-alerts.md).

Yarn shortcuts require a host workspace installed with `yarn install --immutable`.
On a Docker-only checkout, use the direct Node commands in that startup sequence;
the migration and diagnostic scripts need Node 22 but no host npm dependencies.
The standard `deploy.sh` installs the workspace with Corepack and compiles the
applications on the host before building their Docker images. The registry
`--no-build` path skips that installation and those builds.

Only after those prerequisites and authorization for the target, deliver API/Web:

```bash
bash scripts/deploy.sh
```

## Optional Private PostgreSQL

The limited public transparency fallback can run without PostgreSQL in development.
Real Checkout requires durable PostgreSQL operations (migration 031); production
administration requires OIDC and PostgreSQL. Sponsorship follow-up, public directories
and alert episodes also require the private database.

To initialize private PostgreSQL on an authorized fresh environment:

1. Set these values in `.env`:

```env
POSTGRES_DB=openg7_funding
POSTGRES_USER=openg7_funding_owner
POSTGRES_PASSWORD=replace_with_a_long_random_secret
FUNDING_DATABASE_RUNTIME_USER=openg7_funding_api
FUNDING_DATABASE_RUNTIME_PASSWORD=replace_with_a_different_long_random_secret
DATABASE_URL=postgres://openg7_funding_api:replace_with_a_different_long_random_secret@postgres:5432/openg7_funding
```

2. Start PostgreSQL on the private Compose network:

```bash
docker compose --profile database up -d postgres
```

3. On a fresh database, apply the full sequence from the host with the runtime-role
   override explicitly empty for this first application (the runner otherwise loads `.env`):

```bash
FUNDING_DATABASE_RUNTIME_USER= node scripts/db-migrate.mjs
```

Use the complete migration directory; applying only `001`–`007` leaves most
administrative features unavailable. The shared Node 22 runner records applied
files and their checksums. An existing database without that registry requires
[reviewed history adoption](operations/database-migrations.md#adoption-dune-base-existante-sans-registre)
before any further application. It never infers migration history from table names.

4. Follow the separately authorized runtime-role provisioning below. For a first
   production start, return to the [OIDC startup sequence](operations/keycloak-vps.md#premier-demarrage-oidc)
   and deliver the application only once the provider and owners are ready.
   The application deployment retains the identity overlay for Traefik; a bare
   `docker compose up` omits that managed overlay.

Security notes:

- `postgres` is only attached to the internal `openg7-data` network.
- No `5432` port is published on the host.
- The browser never receives `DATABASE_URL`.
- Production refuses absent PostgreSQL; the Stripe-direct transparency fallback
  remains available for compatible development paths.

<a id="compte-postgresql-applicatif"></a>

### Compte PostgreSQL applicatif

Le compte initial `POSTGRES_USER` de l'image PostgreSQL est administrateur. Le
conserver pour les migrations sur l'hôte; sur une installation existante, ne pas
le renommer par une simple modification de `.env`. L'API reçoit uniquement les
variables déclarées dans Compose, jamais le fichier `.env` complet ni
`POSTGRES_PASSWORD` ou `FUNDING_DATABASE_RUNTIME_PASSWORD`.

Préparer un mot de passe indépendant d'au moins 32 caractères, renseigner les
deux variables `FUNDING_DATABASE_RUNTIME_*`, puis utiliser ce même compte dans
`DATABASE_URL` (encoder les caractères réservés de l'URL). Le plan ne se connecte
à aucune base. Sur une cible existante, sauvegarde vérifiée, recette isolée et
instruction explicite pour modifier les droits précèdent l'application :

```sh
node scripts/db-runtime-role.mjs --plan
node scripts/db-runtime-role.mjs --apply \
  --confirm-database openg7_funding --confirm-role openg7_funding_api
```

Le provisionnement transactionnel est idempotent et ne change pas un mot de passe
existant. Il refuse un compte administrateur, propriétaire ou membre d'un autre
rôle. Le compte API reçoit connexion, usage du schéma, lecture/insertion/mise à
jour métier et usage/lecture des séquences. Seuls les challenges de connexion
expirés peuvent être supprimés; l'audit reste en lecture/insertion et le registre
des migrations en lecture. Aucune création de schéma/table temporaire, propriété,
suppression métier ou `TRUNCATE`. Le schéma et la base dédiés perdent les droits
`CREATE`/`TEMPORARY` publics, sans supprimer de données.

Les migrations gardent le compte propriétaire. Lorsque le rôle runtime est
configuré et déjà provisionné, leur runner réapplique ses droits sur les nouvelles
tables dans la même transaction, sans modifier de mot de passe. En production,
l'API vérifie les privilèges effectifs avant d'écouter et refuse une dérive.
Une configuration préparée ne modifie aucun compte existant ni la production.

## DNS

The hostname must resolve publicly to the VPS IPv4/IPv6 before Traefik can obtain a certificate:

```bash
getent hosts openg7.org
```

Ports required:

- TCP 80
- TCP 443
- UDP 443 for HTTP/3
- SSH 22

## HTTPS and Certificates

Traefik uses Let's Encrypt HTTP-01 challenge:

- Static config: `traefik/traefik.yml`
- Dynamic routes, services, middlewares, and TLS policy: `traefik/dynamic.yml`
- Persistent ACME store: `traefik/acme/acme.json`

### Demarrage Docker guide

`yarn docker:up` propose local/dev (par defaut), prod ou autre. Les commandes
suivantes fixent l'environnement, notamment sans terminal interactif :

```sh
yarn docker:up:dev
yarn docker:up:prod --dry-run
yarn docker:up --environment autre
yarn docker:up:dev --dry-run
```

En terminal interactif, le lanceur demande ensuite l'authentification :
`yarn docker:up:dev` propose `token`, `keycloak`, `oidc` ou `configured`, et
`yarn docker:up:prod` propose `keycloak`, `oidc` ou `configured`. Entree et
`configured` conservent le mode de `.env`/shell. Sans terminal interactif ou
avec `--dry-run`, aucune question d'authentification n'est posee et ce mode
reste configure, sauf choix explicite. `--auth token|keycloak|oidc|configured`
fixe ce choix pour local/dev ou prod ; token est reserve au developpement et
refuse en production, meme lorsqu'il vient de `.env`. Un choix explicite
`token`, `keycloak` ou `oidc` est refuse avec un `COMPOSE_FILE` personnalise ;
`configured` et l'absence de choix conservent ce modele. Ces exemples fixent
aussi le choix d'authentification :

```sh
yarn docker:up:dev:token --no-stripe-webhook
yarn docker:up:dev:keycloak --no-stripe-webhook
yarn docker:up:dev --auth configured --no-stripe-webhook
yarn docker:up:dev --auth keycloak --no-stripe-webhook --dry-run
```

Token utilise les secrets locaux existants et exclut la surcharge identite.
Des conteneurs Keycloak deja presents peuvent rester actifs ; ce choix ne les
arrete pas et ne supprime ni leur DB ni leurs volumes. Keycloak active OIDC avec
`auth.openg7.test`, `https://localhost`, l'issuer
`https://auth.openg7.test/realms/openg7` et `FUNDING_ADMIN_OIDC_MFA_ACR` vide.
Il reutilise les secrets, le client et le compte bootstrap configures ; les
valeurs par defaut des deux noms sont `openg7-funding-admin` et
`keycloak-local-bootstrap`. Le selecteur ne genere aucun secret et ne cree
pas de compte OpenG7. Ces valeurs locales s'appliquent uniquement a local/dev.
Le profil Keycloak local inclut la surcharge TLS meme si les certificats sont
absents ; le lanceur les prepare si necessaire avant Docker, selon la procedure
[HTTPS locale](#https-local-de-confiance).
Le choix `oidc`, disponible aussi en developpement, utilise la configuration
OIDC externe existante et exclut la surcharge Keycloak.

En production, les aliases `docker:up:prod`, `docker:up:prod:keycloak` et
`docker:up:prod:oidc` incluent le profil PostgreSQL. Le choix Keycloak conserve
l'hote DNS public (sans domaine `.test`), l'origine publique, le client, le
compte bootstrap et les secrets prepares dans `.env`/shell. Il calcule l'issuer
`https://<FUNDING_KEYCLOAK_HOSTNAME>/realms/openg7` et fixe
`FUNDING_ADMIN_OIDC_MFA_ACR` vide ; aucun defaut local n'est applique.
Le choix `oidc` designe un fournisseur externe : il conserve issuer, client,
secret, preuve MFA et origine publique configures, et exclut la surcharge
Keycloak. Ces modes de production n'utilisent ni TLS local ni relais Stripe.

```sh
yarn docker:up:prod:keycloak --dry-run
yarn docker:up:prod:oidc --dry-run
```

Pour les choix explicites de production `keycloak` et `oidc`, le preflight
controle la configuration : HTTPS hors loopback, origine publique exacte et
base API sur la meme origine. Il ne contacte pas le fournisseur et
ne qualifie ni DNS/certificats, comptes, OTP, proprietaires, migrations ni
sauvegardes. Suivre le [guide Keycloak VPS](operations/keycloak-vps.md) et le
[runbook des acces](operations/admin-identity-and-alerts.md) pour ces
preconditions sur une cible autorisee. Le choix ne reconcilie pas un realm
ou client deja stocke et ne retire ni n'arrete les anciens services.
Pour Keycloak, l'execution reelle ajoute la preparation et la verification
[HTTPS du fournisseur](#https-de-lidentite-en-production) avant le demarrage
applicatif ; le preflight et `--dry-run` restent sans appel au fournisseur.

Ce choix vaut uniquement pour cette invocation et ne modifie pas `.env`.
Pour redemarrer avec le meme choix explicite, reprendre le meme alias
`:token`, `:keycloak` ou `:oidc`. `docker:recreate`, `docker:update`, les commandes TLS
et `keycloak:check` continuent de lire `.env`/shell ; les configurer de facon
coherente avant de les utiliser, car ils ne memorisent pas le choix precedent.
Un changement d'issuer filtre les comptes et sessions selon le nouvel issuer,
sans transferer les comptes. Les anciennes sessions restent en DB et peuvent
redevenir valides si l'ancien issuer est retabli avant expiration, sans
revocation. Gerer ou revoquer explicitement ces sessions avant la bascule selon
le [processus d'acces approuve](operations/admin-identity-and-alerts.md).

Local/dev utilise la configuration de developpement pour l'API et le build
Angular, active PostgreSQL, construit les images puis attend les services avec
`docker compose up -d --wait`. Il lance ensuite le meme relais de test que
`yarn stripe:webhook:listen` dans le terminal. Garder ce terminal ouvert pendant
les paiements de test; `Ctrl+C` arrete le relais, les conteneurs restent actifs.
`--no-stripe-webhook` desactive ce relais et `--no-database` desactive le profil
PostgreSQL. Pour le demarrage local detache sans relais, utiliser
`yarn docker:up:dev --no-stripe-webhook` : build de developpement, PostgreSQL
et surcharge TLS locale lorsque les certificats sont presents, ou preparation
automatique de cette surcharge pour Keycloak local.

Local/dev ajoute `https://localhost` et `https://127.0.0.1` aux origines
autorisees de l'API, en conservant celles de `FUNDING_ALLOWED_ORIGINS`.
Cela permet les actions admin depuis ces adresses locales. Prod et autre
conservent les origines configurees sans ajout automatique.

Le relais exige Stripe CLI, une cle de test et un `STRIPE_WEBHOOK_SECRET`
correspondant au meme compte; ils sont verifies avant le build. La cle utilisee
est celle de `.env` ou du shell, pas celle d'une autre connexion CLI. Les secrets
ne sont ni affiches ni modifies. Le relais controle HTTPS avant de transmettre
des evenements : preparer le certificat
avec `yarn tls:local:setup`. Lorsque les fichiers de certificat sont presents,
le mode local ajoute la surcharge TLS ci-dessous, sauf si `COMPOSE_FILE` definit
deja une configuration personnalisee (qui doit alors inclure cette surcharge).

Le relais consulte `stripe listen --help` et choisit explicitement les evenements
snapshot : `--all-snapshot` lorsque l'aide annonce cette option, sinon
`--events '*'` pour les anciennes CLI. La selection des arguments et les
garde-fous du lanceur se verifient avec des fixtures synthetiques, sans demarrer
Docker ni une CLI Stripe reelle :

```sh
node --test tests/docker-up.test.mjs
```

Prod utilise les builds de production et ne lance aucun relais. Autre conserve
la configuration `.env`/shell et ne lance aucun relais. Ces choix ne selectionnent
pas de serveur, ne changent pas les secrets et ne remplacent pas la procedure de
deploiement. PostgreSQL peut etre ajoute avec `--database`.
En production OIDC, ce profil est requis pour la DB Funding privee. Sans
`--identity-only`, la commande construit et demarre la pile complete, y compris
l'identite activee, mais ne migre pas la base et ne provisionne pas son role runtime. Suivre le
[premier demarrage OIDC](operations/keycloak-vps.md#premier-demarrage-oidc) avant une
reconstruction autorisee ; la livraison applicative reste `bash scripts/deploy.sh`.
Sans terminal, `--environment local|prod|autre` est obligatoire, meme si
`FUNDING_PLATFORM_ENV` figure dans `.env`. `--dry-run` affiche uniquement les
commandes prevues. Lorsqu'un fichier d'environnement est present, Docker Compose
doit etre installe : son parseur resout la configuration sans contacter le daemon
ni Stripe et sans demarrer de service. Les references entre variables, guillemets
et commentaires suivent la syntaxe Compose ; le shell reste prioritaire et les
valeurs privees ne sont pas imprimees. Le meme lecteur sert a `docker:update` et
au preflight Keycloak. Les migrations et le rattrapage des paiements restent des
operations separees.

### HTTPS de l'identite en production

Sur un VPS Linux autorise, `yarn docker:up:prod:keycloak` prepare HTTPS pour
`FUNDING_KEYCLOAK_HOSTNAME` avec Let's Encrypt. Cet hote doit resoudre
publiquement vers ce VPS, avec TCP 80 accessible pour HTTP-01 et TCP 443 pour
HTTPS. Conserver un AAAA uniquement si IPv6 dessert effectivement l'hote et
renseigner `LETSENCRYPT_EMAIL` avec une adresse operationnelle reelle, sans
reprendre les valeurs d'exemple. Le lanceur ne configure ni DNS ni pare-feu.
Cette preparation gere le certificat de l'hote Keycloak ; les routes Web/API
restent celles de `openg7.org` et `www.openg7.org`, sans generation de routage
pour un autre site.

Apres validation Compose et build, le lanceur cree si necessaire le stockage
persistant `traefik/acme/acme.json` : repertoire `700`, fichier `600`. Un etat
deja protege est conserve sans lecture de son contenu ni nouveau `chmod`.
L'execution reelle est refusee sous Windows avant tout effet.

Un operateur non-root ayant acces Docker peut utiliser un repertoire ACME
appartenant a root, inaccessible a son compte. Le lanceur ne demande pas `sudo` :
dans ce cas, un conteneur ephemere utilisant l'image Traefik effective de Compose
controle uniquement les types, modes et l'identite du repertoire (peripherique/inode),
avec reseau desactive, systeme de fichiers et montage ACME en lecture seule.
Il ne lit aucun contenu et ne cree, ne reinitialise ni ne change le proprietaire
du stockage. Un stockage incorrect bloque le demarrage de l'identite ; son
proprietaire doit corriger les permissions. Ce controle exige le daemon Docker
local execute par root sur le VPS : un contexte distant ou rootless peut etre
refuse si l'identite ou les permissions ne peuvent etre prouvees. Docker peut
telecharger l'image Traefik si elle est absente, comme lors du demarrage Compose.

Le lanceur demarre `identity-postgres`, `keycloak` et `traefik` avec une attente
bornee a 180 secondes, puis sonde HTTPS avec la verification TLS native de Node.
Un second budget total de 180 secondes couvre discovery, issuer exact, endpoints
OIDC et JWKS. La pile complete demarre uniquement apres cette verification ;
un echec interrompt le parcours et les services deja demarres restent a examiner.

Pour le premier bootstrap, examiner le plan limite a l'identite :

```sh
yarn docker:up:prod:keycloak --identity-only --dry-run
```

`--identity-only` est reserve a Keycloak en production : il construit uniquement
Keycloak, puis prepare ACME, demarre et verifie les trois services d'identite.
Il ne demarre ni API, Web, workers ni DB Funding. Utiliser ce parcours sur la
cible autorisee avant de preparer les comptes nominatifs, OTP, subjects
proprietaires, migrations et role DB runtime selon le
[guide VPS](operations/keycloak-vps.md#configuration-et-démarrage-séparé).
Ces preconditions et la qualification de production restent manuelles avant
tout demarrage complet ; `bash scripts/deploy.sh` reste la livraison canonique.
Discovery et JWKS ne prouvent ni MFA ni droits applicatifs.

`--dry-run` annonce la preparation ACME, les commandes et la sonde sans ecriture
de fichiers, reseau ni contact du daemon ; aucun conteneur de controle n'est
demarre. OIDC externe conserve ses certificats et sa preparation propres :
ce lanceur ne genere ni ne repare le certificat du
fournisseur externe. Aucun certificat mkcert local n'est utilise en production.

### HTTPS local de confiance

Le certificat genere par defaut par Traefik n'est pas approuve par les
navigateurs. Sous Windows, le raccourci suivant installe `mkcert` avec
`winget` lorsqu'il est absent, installe son autorite locale, genere un
certificat pour `localhost`, `127.0.0.1`, `::1` et `auth.openg7.test`, puis recree uniquement
Traefik avec `docker-compose.local-tls.yml` :

```powershell
yarn tls:local:setup
```

Fermer et rouvrir Firefox apres la premiere execution. Le renouvellement du
certificat local utilise :

```powershell
yarn tls:local:renew
```

Le setup copie aussi le certificat public de la CA dans `traefik/certs/rootCA.pem`.
Pour utiliser Keycloak local avec confiance HTTPS dans le navigateur et l'API
Docker, suivre le [guide Windows/Docker](operations/keycloak-local.md) : résolution
du domaine, préparation de la surcharge locale, OTP et DB Funding distincte.
`yarn docker:up:dev:keycloak --no-stripe-webhook` fixe ce choix pour le démarrage.
Avant Docker, le lanceur valide le certificat, sa clé et la CA publique. Si ces
fichiers sont absents, invalides ou expirés, il exécute
`node scripts/setup-local-tls.mjs --renew --no-restart` avec la configuration
effective du choix Keycloak, puis revalide les certificats et prépare les fichiers
Traefik locaux. Des certificats valides sont conservés. Ce setup peut installer
`mkcert` avec `winget` et demander l'approbation de sa CA dans Windows ; un échec
interrompt le démarrage avant Docker. `--dry-run` annonce les étapes nécessaires
sans installation, changement de confiance, génération de fichier ni démarrage.
Si le setup automatique change la CA publique, le lanceur arrête uniquement
`api` après le build et avant `up -d --wait` pour que Node recharge la CA ; une
CA inchangée ne déclenche pas cet arrêt.

Cette préparation automatique concerne uniquement Keycloak local, pas les modes
token, OIDC externe ou production. Les commandes TLS lancées séparément lisent
toujours `.env`/shell. Les secrets, hosts, comptes, OTP, propriétaires, rôle DB
runtime et migrations restent à préparer une fois selon le guide ; le lanceur
ne les crée pas. Le choix `--auth keycloak` en production conserve les domaines
publics prepares et n'active pas ce profil TLS local.

Les fichiers sous `traefik/certs/` sont locaux et ignores par Git. Ne jamais
copier `localhost-key.pem` ni la cle privee de l'autorite mkcert vers le depot
ou le VPS. La surcharge locale ajoute seulement le certificat de developpement;
la configuration de production continue d'utiliser Let's Encrypt.

Create secure ACME storage:

```bash
mkdir -p traefik/acme
touch traefik/acme/acme.json
chmod 600 traefik/acme/acme.json
```

Verify certificate:

```bash
echo | openssl s_client -servername openg7.org -connect openg7.org:443 2>/dev/null | openssl x509 -noout -issuer -subject -dates
```

Traefik renews certificates automatically. The helper script checks expiry and reloads Traefik when renewal is near:

```bash
bash scripts/renew-certs.sh
```

Suggested cron:

```bash
0 3 * * * cd /opt/openg7-funding-platform && bash scripts/renew-certs.sh >> /var/log/openg7-renew.log 2>&1
```

## Traefik Dashboard

The dashboard is local-only:

```text
http://127.0.0.1:8081/dashboard/
```

Use an SSH tunnel from your workstation:

```bash
ssh -L 8081:127.0.0.1:8081 "${VPS_USER:-ubuntu}@${VPS_HOST}"
```

Then open:

```text
http://127.0.0.1:8081/dashboard/
```

## Security

Compose pins Traefik 3.7.13, on the maintained 3.7 branch, including the
[HTTP/2 panic fix](https://github.com/traefik/traefik/security/advisories/GHSA-4hjq-9h5c-252j)
and subsequent security fixes. Review the
[minor-version migration guide](https://doc.traefik.io/traefik/v3.7/migrate/v3/)
before an explicitly authorized deployment. A manifest change does not update
an already running proxy.

Applied:

- HTTP to HTTPS redirect
- TLS 1.2 and TLS 1.3 only
- HSTS with preload
- CSP
- `X-Frame-Options: DENY`
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy`
- Traefik rate limits
- Nginx `client_max_body_size 256k`, sauf `9m` sur le seul endpoint de
  televersement des medias de commandite
- Traefik limite ce meme endpoint a `9 MiB`; l'API conserve la limite
  fonctionnelle configuree par `FUNDING_SPONSOR_MEDIA_MAX_BYTES` (`8 MiB` par
  defaut et plafond maximal; les valeurs invalides sont refusees au demarrage)
- API body limit
- API in-process rate limits for checkout, sponsorship follow-up, and admin sponsorship routes
- `FUNDING_TRUSTED_PROXY_HOPS` est un réglage privé serveur : absent, il vaut
  `0` et les en-têtes d'adresse client sont ignorés. Compose utilise `1`, car
  l'API n'est pas publiée et reçoit les requêtes via un proxy. L'adresse retenue
  est l'entrée correspondante en partant de la droite de `X-Forwarded-For`;
  un préfixe fourni par le client ne change pas le quota. Utiliser `0` pour
  une API accessible directement; ne jamais activer la confiance sans isoler
  son accès. Les valeurs hors de l'intervalle entier 0–8 bloquent le démarrage.
- API checkout amount allow-list
- API checkout return URL validation
- API sponsorship follow-up tokens are hashed at rest, expire by configuration, and are removed from the browser URL after page load
- Stripe webhook signature verification
- Docker `no-new-privileges`
- Nginx unprivileged container
- API service not directly published
- Traefik routes are declared through the file provider, so the Docker socket is not mounted into Traefik
- Traefik dashboard and cAdvisor bound to localhost only

## Deployment

For the first production start, finish the [OIDC prerequisites and application sequence](operations/keycloak-vps.md#premier-demarrage-oidc)
before running this delivery. Application deployment and rollback preserve the
managed identity overlay but do not build, start or restore Keycloak or its DB.
Prepare and maintain those identity services separately.

The deployment runner calls `scripts/db-migrate.sh` when a database is configured.
Both migration entrypoints require Node 22 or newer on the host, including image-only
deployments, and use the same registry, checksums and transaction lock.
Review the [migration plan and legacy adoption procedure](operations/database-migrations.md)
before deploying to an existing database. Pending SQL commits as one batch;
an image rollback does not undo migrations committed by an earlier run.

Prepare the intended Git checkout explicitly. `deploy.sh` deploys that checkout
and never runs `git pull`; `yarn vps:update` remains the explicit pull-and-deploy
wrapper, while `yarn vps:deploy` uses the revision already present.

Local build on VPS:

```bash
bash scripts/deploy.sh
```

Registry deployment: set `WEB_IMAGE` and `API_IMAGE` in `.env` to the two GHCR
images tagged with the checkout's full 40-character commit SHA, then run:

```bash
DEPLOY_REVISION="$(git rev-parse HEAD)"
bash scripts/deploy.sh --no-build --revision "${DEPLOY_REVISION}"
```

The revision check rejects tracked changes and mismatched image tags before
Docker operations. The GitHub workflow publishes full SHA tags and serializes
deliveries. See the [current platform status](platform-status.md) for validation
scope and the deployment contract.

Rollback:

The deployment script tags currently running images as:

```text
openg7-funding-web:rollback
openg7-funding-api:rollback
openg7-funding-operations:rollback
```

If validation fails, it attempts to redeploy these rollback images.

Manual rollback on the VPS:

```bash
bash scripts/rollback.sh
```

Manual rollback from a workstation:

```bash
yarn vps:rollback
```

This rolls back `web`, `api` and the previously enabled operations image. A worker
introduced by the failed delivery is stopped. The previous activation is recorded
in `backups/deployment-rollback.env`; do not remove it before a rollback.
Deployments using `--revision` also write a receipt linking that revision to
the exact Web/API/watcher image IDs after health checks. The next delivery only
associates its rollback copies with a revision if the running images match the
current receipt. `backups/deployment-{current,rollback}.revision` contains no
credentials. A revision-qualified rollback (`bash scripts/rollback.sh --revision
<full-SHA>`) refuses missing receipts, changed image tags or a different revision
before changing services, then restores immutable image IDs. The optional launch
agent requires this association; existing installations cannot infer it from Git
HEAD or an older SQLite entry.
It does not restore
PostgreSQL data. Restore a database backup separately if a database migration
must also be reverted.

## Validation

Run:

```bash
bash scripts/check.sh
```

Also verify the public usage and refund policy routes:

```text
https://openg7.org/politique-utilisation-remboursement
https://openg7.org/en/politique-utilisation-remboursement
```

It verifies:

- Docker
- Compose
- containers
- DNS
- HTTP
- HTTPS
- certificate issuer and expiry
- Angular shell
- API public transparency
- Traefik local dashboard
- cAdvisor local metrics

## Backup

Database and backup shortcuts are available from `package.json`:

```bash
yarn db:migrate
yarn db:backup
yarn db:restore --help
```

`yarn db:migrate` starts the private PostgreSQL service if needed, waits for it
to become ready, then validates recorded checksums and applies only pending SQL
files from `apps/funding-api/migrations`, in numeric order, under a database lock
and a transaction. The local and VPS entrypoints share this registry-based runner.
New migrations must be additive, numbered `.sql` files; applied files stay immutable.
Use `node scripts/db-migrate.mjs --plan` to inspect an already running target
without starting it or creating a registry. Existing databases without a registry
require [reviewed history adoption](operations/database-migrations.md#adoption-dune-base-existante-sans-registre)
before further application. Node 22 or newer and Docker Compose are required on the host;
the [migration procedure](operations/database-migrations.md) defines target
selection, execution limits and recovery after failure.

Run:

```bash
bash scripts/backup.sh
```

Backups include:

- Compose config
- `.env`
- Dockerfiles
- Nginx config
- Traefik config
- ACME certificates
- scripts
- docs

The optional Keycloak identity database and its overlay/image need a separate
[backup and recovery procedure](operations/keycloak-vps.md#sauvegarde-identite).
Application backup/restore and rollback do not restore this provider.

Install `age` on the backup host, and set the public
`FUNDING_FULL_BACKUP_AGE_RECIPIENT` generated on an independent recovery workstation.
Its private identity stays off the VPS. Configuration, database and media are
streamed through authenticated encryption before any backup file is written.
The script refuses an absent/invalid recipient or unavailable encryption tool.

Node 22 is required for integrity metadata. A completed set includes the
configuration archive's adjacent `.manifest.json`, with UTC date, environment,
database, media driver, sizes and SHA-256 digests. Freeze application writes for
a coherent DB/media capture; `pg_dump` alone does not freeze media. See the
[backup and recovery procedure](operations/backup-recovery.md).

If private PostgreSQL is enabled through `DATABASE_URL`, `scripts/backup.sh`
also writes a consistent database dump while PostgreSQL is running:

```text
backups/openg7-funding-db-YYYYMMDDTHHMMSSZ.sql.age
```

If the `openg7-sponsor-logos` Docker volume exists, the same script also writes:

```text
backups/openg7-sponsor-logos-YYYYMMDDTHHMMSSZ.tar.gz.age
```

The configuration archive is `openg7-backup-YYYYMMDDTHHMMSSZ.tar.gz.age`;
its adjacent manifest hashes ciphertext and declares encryption version 2.
Store both the configuration archive and the database dump outside the VPS as
private secrets. The database may contain Stripe event payloads, sponsorship
follow-up data, and admin review data.

When `SPONSOR_MEDIA_STORAGE_DRIVER=local`, uploaded sponsor logos are stored in
the `openg7-sponsor-logos` Docker volume mounted at `/app/var/sponsor-logos` in
the API container. Store sponsor logo volume archives with the configuration and
database backups whenever local sponsor logo uploads are enabled.

When `SPONSOR_MEDIA_STORAGE_DRIVER=ovh-s3`, uploaded controlled sponsor logos
are stored in the OVH private bucket. The API still serves
`/api/public/sponsor-logos/<file>` only after database approval, so the browser
never receives OVH credentials and the private bucket remains anonymous-private.
Run `npm run storage:check` and `npm run storage:test` after changing the OVH
storage configuration.

Suggested cron:

```bash
30 3 * * * cd /opt/openg7-funding-platform && bash scripts/backup.sh >> /var/log/openg7-backup.log 2>&1
```

## Restore

Use a trusted compatible checkout on a dedicated recovery target without `.env`,
with a new project name and unused volumes/networks. The source is preserved.
The local-media path requires all three artifacts and the integrity manifest:

```bash
bash scripts/restore-from-backup.sh \
  --target-project openg7-recovery-20260925 \
  --config-backup /path/to/openg7-backup-YYYYMMDDTHHMMSSZ.tar.gz.age \
  --database-dump /path/to/openg7-funding-db-YYYYMMDDTHHMMSSZ.sql.age \
  --sponsor-logos-backup /path/to/openg7-sponsor-logos-YYYYMMDDTHHMMSSZ.tar.gz.age \
  --identity /secure/offline-recovery.agekey
```

The script verifies archive integrity and the dedicated Compose target, restores
configuration, imports schema/data atomically and restores local or S3 media. It never
removes existing volumes and leaves API/Web/workers stopped. `--force` skips only
the typed confirmation; `--skip-check` is no longer supported. No migrations run.
Decryption occurs only in protected temporary recovery staging, removed on exit.
Old clear archives require the additional explicit `--allow-legacy-plaintext` option;
new captures always require encryption. Existing clear archives are not rewritten.
New dumps omit ownership and grants (`--no-owner --no-acl`). Reprovision the
[restricted runtime account](#compte-postgresql-applicatif) on the explicit recovery
target before API startup; global roles and source permissions are not restored.

Before activation, verify business records, documents, media and access, reconcile
Stripe and delivery outcomes since the snapshot, and review restored worker
settings. See the [recovery runbook](operations/backup-recovery.md) for preconditions,
failure handling, activation and the automated local recipe. For combined PostgreSQL
and S3 recovery, add `--s3-env /secure/recovery-s3.env` and
`--confirm-s3-target recovery-private,recovery-public`. Both buckets must be new,
empty and private. The explicit file replaces inherited storage credentials and
the resolved API configuration is checked against it. The protected
`recovery-report.json` records progress and partial failure; `restored-stopped`
still requires application checks. Stored public URLs and provider state need
reconciliation before activation. See the
[combined recovery procedure](operations/backup-recovery.md#variante-postgresql-et-s3).

Before application startup, run the [read-only recovery audit](operations/backup-recovery.md#audit-automatisé-en-lecture-seule)
against the explicit recovery directory/project. It checks monetary/document
consistency, referenced media and pending work, and writes a separate protected
report. Exit code 0 never authorizes activation or replaces provider reconciliation.

## GitHub Actions CI/CD

The Web stays on Angular 21: framework 21.2.25 and build/CLI/SSR tooling
21.2.24. The root resolution pins the build worker Piscina to 5.3.2 because
Angular's toolchain still requires vulnerable 5.2.0 exactly; review and remove
this override when the upstream tooling carries the corrected worker. See the
[upstream advisory](https://github.com/piscinajs/piscina/security/advisories/GHSA-67c8-pqhq-4rmx).
Node 22 remains the runtime for images and validation.
The development command runner also pins `shell-quote` 1.9.0 because
Concurrently 9.2.3 requires vulnerable 1.8.4 exactly. Both overrides remain
temporary until their owning tools ship compatible fixed versions.

Workflow:

```text
.github/workflows/deploy.yml
```

Required GitHub secrets:

```text
VPS_HOST=<production VPS host>
VPS_USER=ubuntu
VPS_SSH_KEY=<private SSH key>
VPS_SSH_FINGERPRINT=<independently verified OpenSSH SHA256 host fingerprint>
VPS_APP_DIR=/opt/openg7-funding-platform
PRODUCTION_ENV=<full .env content>
GHCR_PAT=<GitHub token with read:packages for the VPS pull>
```

Verify the fingerprint of the host key negotiated by `appleboy/ssh-action@v1.2.0`
through a trusted VPS console. Its Go SSH client prefers standard ECDSA host keys,
then RSA, then Ed25519 ([client preference order](https://github.com/golang/crypto/blob/v0.29.0/ssh/common.go#L65-L77)).
Check the keys and algorithms actually enabled in `sshd`; a public-key file alone
does not prove that the server offers it. On a VPS offering ECDSA, obtain the pin
with `ssh-keygen -lf /etc/ssh/ssh_host_ecdsa_key.pub -E sha256`. If ECDSA is not
offered, use `/etc/ssh/ssh_host_rsa_key.pub` with the same command; use
`/etc/ssh/ssh_host_ed25519_key.pub` only when neither ECDSA nor RSA is offered.
Set `VPS_SSH_FINGERPRINT` to the verified `SHA256:...` value for that negotiated
key. The deployment fails before SSH when the pin is missing or malformed, and
rejects a different negotiated key. Verify legitimate key or algorithm changes
independently before updating the pin.

The optional [ProductionLaunchAgent](../apps/production-launch-agent/README.md)
uses the separate `PLA_SSH_HOST_FINGERPRINT` pin. Its Node SSH client prefers
Ed25519, so independently verify the key negotiated by that client; the two pins
can differ for the same VPS.

The workflow writes configuration atomically through a temporary file with mode
`600`, under `umask 077`. Docker build contexts exclude backups, TLS keys and the
optional agent's secrets, runtime reports and SQLite files. Keep these artifacts
outside Git and never use an alternate build context without equivalent exclusions.

The workflow:

1. Installs dependencies.
2. Runs lint.
3. Builds TypeScript.
4. Builds Angular.
5. Runs tests.
6. Builds Docker images.
7. Pushes images to GHCR.
8. Deploys to the VPS via SSH.
9. Runs production validation.
10. Lets `scripts/deploy.sh` rollback on failure.

## Logs and Metrics

Traefik logs are JSON:

```bash
docker compose logs -f traefik
```

Nginx output is available through Docker logs; API access logging under `/api/`
is disabled to avoid logging OIDC callback codes. Traefik access logs omit
request paths, request lines and headers. Do not enable those fields while
diagnosing identity failures:

```bash
docker compose logs -f web
```

API logs:

```bash
docker compose logs -f api
```

Docker metrics:

```bash
ssh -L 8082:127.0.0.1:8082 "${VPS_USER:-ubuntu}@${VPS_HOST}"
```

Open:

```text
http://127.0.0.1:8082
```

## Troubleshooting

If Web reports `dependency api failed to start`, it is waiting for the API
healthcheck; inspect the API's startup refusal first. For managed Keycloak, use
the [startup diagnostic with the identity overlay](operations/keycloak-vps.md#diagnostic-dependance-api).
Do not omit enabled overlays when recreating Traefik or the application.

Check containers:

```bash
docker compose ps -a api web
```

If the API restarts in a loop:

```bash
docker compose logs --tail=100 api
docker compose config --quiet
node scripts/services-check.mjs
```

These checks avoid printing expanded secret values. `services:check` validates
the selected token/OIDC configuration and any configured operations webhook.
It makes no provider calls and does not verify MFA, migrations, runtime DB rights,
the encryption key or alert delivery.
Use the [identity runbook](operations/admin-identity-and-alerts.md#diagnostic-de-configuration-avant-recette)
for the remaining checks.

`OIDC requires a secure origin, issuer, client ID and client secret.` means that
the API's OIDC configuration is missing or invalid. Verify the protected `.env`
and the explicit API variables in Compose: HTTPS origin and issuer, confidential
client ID/secret, owner subjects, production mode, Funding `DATABASE_URL` and
private-data encryption key. Read logs locally and redact private values before
sharing them; never print `.env`, tokens or expanded `docker compose config`.
Other startup refusals require checking the restricted database role, migrations
or provider settings identified by the error. Correct the cause before an
authorized delivery. Production cannot fall back to `token`; do not remove data
volumes to make a container start.

Check Traefik:

```bash
docker compose logs --tail=200 traefik
```

Check certificate:

```bash
echo | openssl s_client -servername openg7.org -connect openg7.org:443 2>/dev/null | openssl x509 -noout -issuer -subject -dates
```

Check routes:

```bash
curl -I https://openg7.org
curl -I https://openg7.org/health
curl -I https://openg7.org/api/public/fund-transparency
```

If Let's Encrypt fails:

1. Confirm DNS resolves to the VPS.
2. Confirm ports 80 and 443 are open in OVH firewall and UFW.
3. Confirm `LETSENCRYPT_EMAIL` is valid.
4. Check `docker compose logs traefik`.
5. Remove only invalid staging/test certificates if needed:

```bash
docker compose down
rm -f traefik/acme/acme.json
touch traefik/acme/acme.json
chmod 600 traefik/acme/acme.json
docker compose up -d
```
