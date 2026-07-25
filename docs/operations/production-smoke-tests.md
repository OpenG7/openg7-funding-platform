# Validation des intégrations réelles (runbook non destructif)

Ce runbook regroupe les vérifications **non destructives** permettant de
valider les intégrations réelles d'un environnement OpenG7 (local Docker,
staging ou production) : SMTP, stockage média OVH, topologie Docker/Traefik et
contrat public de l'API.

Principe directeur : **read-only par défaut**. Aucune commande de ce runbook ne
crée de contribution, n'ouvre de session Stripe, n'envoie de courriel réel, ne
supprime de média ni ne déploie. Les commandes qui écrivent réellement quelque
chose (envoi de courriel de test, objets S3 temporaires) sont signalées
explicitement et exigent une intention manuelle.

Les commandes à risque élevé (déploiement, remboursement, backfill live,
restauration, migration prod) restent hors de ce runbook et suivent la
procédure de la section 4.3 de `AGENTS.md`.

## 1. Vue d'ensemble des commandes

| Commande                               | Réseau        | Écrit ?              | Secret requis | Rôle                                                                                                  |
| -------------------------------------- | ------------- | -------------------- | ------------- | ----------------------------------------------------------------------------------------------------- |
| `corepack yarn services:check`         | Non           | Non                  | Non           | Vérifie la présence et la forme de la configuration `.env` sans jamais imprimer de valeur.            |
| `corepack yarn smoke:public`           | Oui (GET)     | Non                  | Non           | Vérifie le contrat public HTTP (santé, `/api`, absence de PII, frontière admin) contre une URL cible. |
| `corepack yarn storage:check`          | Oui (S3)      | Non                  | Oui (OVH)     | Vérifie les buckets OVH, les ACL et le versioning sans modifier de données.                           |
| `corepack yarn storage:test`           | Oui (S3+HTTP) | Oui (temporaire)     | Oui (OVH)     | Crée puis **supprime** des objets `system-tests/` pour prouver l'accès privé/public.                  |
| `corepack yarn email:verify`           | Oui (SMTP)    | Non                  | Oui (SMTP)    | Vérifie la connexion SMTP sans envoyer de message.                                                    |
| `corepack yarn email:test -- --to=…`   | Oui (SMTP)    | **Oui (envoi réel)** | Oui (SMTP)    | Envoie un message de test à un destinataire explicite. À exécuter uniquement sur instruction.         |
| `bash scripts/check.sh` (`prod:check`) | Oui           | Non                  | —             | Vérifie la stack déployée sur le domaine de production (DNS, TLS, santé, dashboards locaux).          |

`services:check` et `smoke:public` ne nécessitent **aucune clé live** et sont
sûrs à lancer en boucle. Les commandes `storage:*` et `email:*` nécessitent les
credentials réels du VPS et se lancent normalement depuis le VPS.

## 2. Configuration (`services:check`)

Vérifie que `.env` contient toutes les variables requises, avec la bonne forme,
sans imprimer les valeurs. Utile avant tout déploiement ou toute autre
vérification live.

```bash
corepack yarn services:check
# Cible un fichier précis, en ignorant l'environnement du shell :
node scripts/services-check.mjs --env .env --env-only
```

Un statut `[MISSING]` bloque (sortie non nulle). Les secrets sont masqués
(`present` au lieu de la valeur). Couvre HTTPS, admin, Stripe, SMTP,
PostgreSQL, stockage média et publication sociale.

## 3. Contrat public HTTP (`smoke:public`)

Vérification portable, **GET uniquement**, du contrat public. C'est un
complément multiplateforme à `scripts/check.sh` : `check.sh` est lié au domaine
de production exact et lit les dashboards Traefik/cAdvisor locaux ; `smoke:public`
se pointe sur n'importe quelle URL (conteneur web local, staging ou prod) depuis
Windows, macOS ou Linux.

```bash
# Stack Docker locale (défaut 127.0.0.1:8080) :
corepack yarn smoke:public

# Staging ou production, en exigeant les en-têtes de sécurité Traefik :
node scripts/smoke-public.mjs --base-url https://openg7.org --expect-secure-headers
```

Résolution de l'URL cible : `--base-url`, puis `SMOKE_BASE_URL`, puis
`PLAYWRIGHT_BASE_URL`, puis `http://127.0.0.1:8080`.

Contrôles effectués :

- `GET /health` renvoie `200 ok`.
- `GET /` sert le shell Angular (`<html>`).
- `GET /api/public/funding-config` renvoie un `business_sponsorship_enabled`
  booléen.
- `GET /api/public/fund-transparency` et `GET /api/public/sponsorships`
  renvoient du JSON **sans champ privé** (`sponsor_contact_email`,
  `email_private`, `stripe_*`, token de suivi…).
- Chaque corps de réponse est scanné : aucune valeur secrète (`sk_live_`,
  `whsec_`, clé privée…) ne doit apparaître. Seul le **nom** du motif détecté
  est rapporté, jamais la valeur.
- `GET /api/admin/dashboard` **sans jeton** doit être rejeté (401/403/503). Un
  `200` est un échec critique de frontière.

Avec `--expect-secure-headers`, l'absence de HSTS, CSP, `X-Frame-Options`,
`X-Content-Type-Options` ou `Referrer-Policy` fait échouer la commande. Sans le
drapeau, ces en-têtes sont rapportés en avertissement (un run pointé
directement sur le conteneur `web` court-circuite Traefik et ne les voit pas).

Sortie non nulle en cas d'échec. Aucune donnée n'est modifiée.

## 4. Stockage média OVH (`storage:check`, `storage:test`)

Détails complets dans [`ovh-object-storage.md`](./ovh-object-storage.md).

```bash
corepack yarn storage:check   # lecture seule : buckets, ACL, versioning
corepack yarn storage:test    # crée puis SUPPRIME des objets system-tests/
```

`storage:check` ne modifie rien. `storage:test` écrit des objets temporaires
sous `system-tests/`, prouve que le bucket privé refuse l'accès anonyme (`403`)
et que le bucket public n'est lisible qu'après `public-read` objet par objet,
puis nettoie via un `trap`. Les deux exigent AWS CLI v2 et les credentials OVH
dans `.env` sur le VPS.

Attendus : `Result: OK` (ou `OK with warnings`), et pour le test les lignes
`Private object rejects anonymous HTTP access with 403` et
`Public object is anonymously readable only after public-read ACL`.

## 5. SMTP (`email:verify`, `email:test`)

Détails complets dans [`email-smtp.md`](../email-smtp.md).

```bash
corepack yarn email:verify                       # connexion seule, aucun envoi
corepack yarn email:test -- --to=adresse@example.com   # ENVOI RÉEL, sur instruction
```

`email:verify` teste uniquement la connexion et l'authentification SMTP ; il
n'envoie aucun message. Les erreurs sont sûres : le code applicatif mappe les
échecs vers des messages fixes (`SMTP authentication failed.`,
`SMTP connection failed.`) avec un code SMTP court, sans jamais imprimer le mot
de passe ; les destinataires sont masqués dans les logs.

`email:test` **envoie un vrai message** à un destinataire explicite : ne pas
l'exécuter sans instruction claire.

Sur le VPS, exécuter ces commandes dans le conteneur API :

```bash
cd /opt/openg7-funding-platform
docker compose exec api node dist/apps/funding-api/src/email-verify.cli.js
```

La file de courriels admin (`/admin/fundraiser/email-queue`) reste la source de
vérité pour les envois réels : elle est persistante, idempotente, garde les
échecs visibles et permet une relance manuelle (`Relancer`).

## 6. Topologie Docker / Traefik / PostgreSQL

Vérifications de configuration sans exécution destructive :

```bash
docker compose config                            # valide la composition
docker compose ps                                # état et santé des services
```

Garanties structurelles à confirmer (voir [`docker-deployment.md`](../docker-deployment.md)) :

- `postgres` n'est attaché qu'au réseau interne `data` ; aucun port `5432`
  publié ; le navigateur ne reçoit jamais `DATABASE_URL`.
- Healthchecks présents pour `traefik`, `api` (`/health`), `web` (`/health`) et
  `postgres` (`pg_isready`).
- Traefik route `/api` vers l'API avec `secure-headers` (HSTS, CSP,
  `X-Frame-Options: DENY`, nosniff, `Referrer-Policy`, `Permissions-Policy`),
  limite de corps, rate limits par route et compression.
- Dashboard Traefik et cAdvisor liés à `127.0.0.1` uniquement.
- Volumes persistants `openg7-postgres-data` et `openg7-sponsor-logos` jamais
  supprimés sans instruction explicite.

Validation live de la stack déployée (sur le domaine de production) :

```bash
bash scripts/check.sh
```

## 7. Sauvegardes

```bash
corepack yarn db:backup       # config + dump DB + archive des logos si présents
```

`scripts/backup.sh` produit une archive de configuration et, si
`DATABASE_URL` est présent, un dump PostgreSQL cohérent ; si le volume
`openg7-sponsor-logos` existe, une archive `.tar.gz` des logos. Stocker ces
artefacts hors du VPS comme secrets. La restauration
(`scripts/restore-from-backup.sh`) est destructive et exige une confirmation
explicite : elle n'appartient pas à ce runbook non destructif.

## 8. Séquence recommandée avant une mise en service

1. `corepack yarn services:check` — configuration complète et bien formée.
2. `docker compose config` et `docker compose ps` — composition et santé.
3. `corepack yarn smoke:public --base-url <url>` — contrat public + frontière
   admin (ajouter `--expect-secure-headers` contre le domaine HTTPS).
4. `corepack yarn storage:check` puis, si demandé, `corepack yarn storage:test`.
5. `corepack yarn email:verify` (et `email:test` uniquement sur instruction).
6. `bash scripts/check.sh` sur le domaine de production.
7. `corepack yarn db:backup` avant tout changement d'état.

## 9. Écarts résiduels connus

- `storage:check`/`storage:test` et `email:verify`/`email:test` exigent des
  credentials réels : ils ne peuvent pas s'exécuter en CI sans secrets et
  restent des vérifications manuelles côté VPS.
- Aucun test applicatif de bout en bout n'exerce le driver `ovh-s3` de
  `funding-api` (upload/remplacement/suppression via S3 réel) ; le driver
  `local` est couvert par les tests. La validation S3 réelle passe par
  `storage:test` et par le rehearsal PostgreSQL de
  `production-launch-checklist.md`.
- La délivrabilité courriel (SPF/DKIM/DMARC) reste une vérification DNS manuelle
  documentée dans `email-smtp.md`.
