# Aide-mémoire des commandes

Exécuter depuis la racine du dépôt, avec Node 22 et Yarn 4. Les scripts de
[package.json](../package.json) font foi. Lire uniquement la section utile.
Les cibles de production, le mode live et les opérations destructives exigent
la [procédure à risque élevé](../AGENTS.md#risque-eleve). Les exemples ne valent
pas autorisation d'exécution.

## Local

| Besoin                                 | Commande                                                              |
| -------------------------------------- | --------------------------------------------------------------------- |
| Installer                              | `corepack enable`, puis `yarn install`                                |
| Web + API                              | `yarn dev`                                                            |
| Web / API séparés                      | `yarn dev:funding-web` / `yarn dev:api`                               |
| Compilation TypeScript                 | `yarn build`                                                          |
| Build Angular                          | `yarn workspace @openg7/funding-web build --configuration production` |
| Tests Node avec compilation            | `yarn test`                                                           |
| Lint / format                          | `yarn lint` / `yarn format:check`                                     |
| Documentation TypeDoc                  | `yarn docs`                                                           |
| Budget et liens des consignes          | `node scripts/check-agent-docs.mjs`                                   |
| Configuration sans afficher de secrets | `yarn services:check`                                                 |

La [matrice de validation](development/validation.md) précise les contrôles
nécessaires, les suites navigateur et leurs prérequis. Ne pas doubler la compilation
de `yarn test`. `services:check` lit la configuration locale, pas celle des
conteneurs; son contrôle admin reste orienté token, sans recette OIDC/MFA.

## Docker Compose

Les raccourcis Docker/DB locaux attendent Docker et tentent d'ouvrir Docker Desktop
si nécessaire. Guide détaillé : [Docker](docker-deployment.md).

| Besoin                                    | Commande                                                                                |
| ----------------------------------------- | --------------------------------------------------------------------------------------- |
| Stack au premier plan avec build          | `yarn docker:up`                                                                        |
| Stack détachée avec PostgreSQL            | `yarn docker:local`                                                                     |
| Mise à jour guidée                        | `yarn docker:update`                                                                    |
| Code local dans les images                | `yarn docker:update --development --no-build-app --no-prune-images --no-stripe-webhook` |
| Ajouter le listener Stripe local          | `yarn docker:update --development --stripe-webhook`                                     |
| Conserver / supprimer les images dangling | `yarn docker:update --no-prune-images` / `yarn docker:update --prune-images`            |
| Arrêter sans supprimer les volumes        | `yarn docker:down`                                                                      |
| Recréer Web/API                           | `yarn docker:recreate`                                                                  |
| Redémarrer un service                     | `docker compose restart web` (ou `api`, `traefik`)                                      |
| État / ressources                         | `docker compose ps` / `docker stats`                                                    |
| Logs ciblés                               | `docker compose logs --tail=100 api` (ou `web`, `traefik`; `-f` pour suivre)            |
| Valider sans exposer l'environnement      | `docker compose config --quiet`                                                         |

`--no-build-app` évite la compilation sur l'hôte; les Dockerfiles compilent
toujours API et Angular. `yarn build`, restart et recreate ne reconstruisent pas
les images. Recharger la page après update; en développement, `Ctrl+F5` peut être utile.

Pour forcer un rebuild local Web sans cache :

```sh
docker compose stop web
docker compose rm -f web
docker image rm openg7-funding-web:local
docker compose build --no-cache web
docker compose up -d web
```

Remplacer `web` par `api` pour l'API. Vérifier d'abord la cible et l'usage de l'image;
si elle est déjà absente, poursuivre au build après vérification de ce seul cas.

## URLs et Stripe

Local Traefik : `https://localhost`; API native : `http://localhost:3333`.
Production : `https://openg7.org`. Webhook : `/api/stripe/webhook`;
projection publique : `/api/public/fund-transparency`.

| Mode test local           | Commande                                                |
| ------------------------- | ------------------------------------------------------- |
| Version CLI               | `yarn stripe:cli:version`                               |
| Listener HTTPS local      | `yarn stripe:webhook:listen`                            |
| Prévisualiser un resend   | `yarn stripe:events:resend evt_1... evt_2... --dry-run` |
| Rejouer des événements    | `yarn stripe:events:resend evt_1... evt_2...`           |
| Prévisualiser un backfill | `yarn stripe:backfill --dry-run`                        |
| Import borné              | `yarn stripe:backfill --from 2026-01-01 --limit 100`    |
| Docker explicite          | `yarn stripe:backfill:docker --dry-run`                 |

Le backfill bascule dans Compose si `DATABASE_URL` utilise l'hôte `postgres`.
Options : `--project`, `--include-unmatched`, `--from`, `--to`, `--limit`,
`--skip-payouts`, `--skip-refunds`, `--skip-disputes`. Préconditions, événements,
reprise et exemples live autorisés : [référence Stripe](technical/stripe.md).

## Tests rapides

`curl -kI https://localhost/health` teste le Web local;
`curl -k https://localhost/api/public/fund-transparency` teste la projection.
`-k` est réservé au certificat local non approuvé. Les vérifications de production
emploient HTTPS vérifié et une cible explicitement autorisée; voir
[smoke tests](operations/production-smoke-tests.md).

Pour les parcours navigateur, privilégier la [recette jetable](development/validation.md)
lorsque l'état local doit être préservé. `yarn test:e2e:playwright` réutilise la
stack locale et exécute migrations/seed; lire leurs préconditions avant lancement.

## Traefik et certificat HTTPS

| Besoin                                        | Commande / guide                                                                                                 |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Logs et redémarrage proxy                     | `docker compose logs --tail=200 traefik`, `docker compose restart traefik`                                       |
| HTTPS local approuvé                          | `yarn tls:local:setup`                                                                                           |
| Renouveler le certificat local                | `yarn tls:local:renew`                                                                                           |
| Vérifier les routes chargées                  | `docker compose exec traefik cat /etc/traefik/dynamic/routes.yml`                                                |
| Vérifier Nginx dans l'image                   | `docker compose exec web cat /etc/nginx/conf.d/default.conf`                                                     |
| Certificats publics, ACME et tunnel dashboard | [Docker/HTTPS](docker-deployment.md#https-and-certificates), [dashboard](docker-deployment.md#traefik-dashboard) |

Le setup local Windows peut installer mkcert via winget, approuver son autorité,
générer les certificats ignorés sous `traefik/certs/` et redémarrer Traefik.
Relancer Firefox après la première installation. Cela ne remplace pas Let's Encrypt.
Pour diagnostiquer une cible publique autorisée :

```sh
echo | openssl s_client -servername openg7.org -connect openg7.org:443 2>/dev/null | openssl x509 -noout -issuer -subject -dates
```

`bash scripts/renew-certs.sh` contrôle le renouvellement; les fichiers ACME sont
sous `traefik/acme/`. Les dashboards Traefik/cAdvisor restent locaux
(`127.0.0.1:8081/dashboard/`, `127.0.0.1:8082/`), accessibles par tunnel SSH.

## Déploiement VPS

Préconditions, première installation, révision/images et retour :
[déploiement Docker/VPS](docker-deployment.md#deployment). Les raccourcis lisent
`VPS_HOST`, `VPS_USER`, `VPS_PORT`, `VPS_APP_DIR` et `VPS_BACKUP_DOWNLOAD_DIR`.
Sans clé SSH, le terminal peut demander un mot de passe.

| Opération autorisée                     | Commande                                               |
| --------------------------------------- | ------------------------------------------------------ |
| Mettre à jour le checkout puis déployer | `yarn vps:update`                                      |
| Même opération sans build VPS           | `yarn vps:update --no-build`                           |
| Déployer le checkout préparé            | `yarn vps:deploy`                                      |
| Contrôler / état / logs                 | `yarn vps:check` / `yarn vps:ps` / `yarn vps:logs api` |
| Shell dans le projet distant            | `yarn vps:ssh`                                         |
| Revenir aux images précédentes          | `yarn vps:rollback`                                    |
| Mettre à jour le code puis migrer       | `yarn vps:db:update` ou `yarn vps:db:migrate`          |
| Console PostgreSQL                      | `yarn vps:db:psql`                                     |

Les deux raccourcis `vps:db:*` de migration font `git pull --ff-only` et ne
déploient pas les images. Le script `deploy.sh` utilise le checkout préparé;
il ne fait pas de pull. Avec `--no-build`, `WEB_IMAGE`/`API_IMAGE` doivent correspondre
au SHA complet fourni par `--revision`. Le rollback des images
`openg7-funding-web:rollback`/`openg7-funding-api:rollback` ne restaure pas la base.

## Sauvegardes et PostgreSQL

Lire les [migrations](operations/database-migrations.md) avant toute application :
les runners rejouent les fichiers, et une base existante peut échouer. Ne pas
modifier les migrations historiques pour contourner cela.

| Opération autorisée                | Commande                                                     |
| ---------------------------------- | ------------------------------------------------------------ |
| PostgreSQL local                   | `yarn db:up`, `yarn db:stop`, `yarn db:logs`, `yarn db:psql` |
| Initialiser une base locale neuve  | `yarn db:migrate`                                            |
| Sauvegarde locale                  | `yarn db:backup`                                             |
| Sauvegarde configuration VPS       | `yarn vps:backup`                                            |
| Sauvegarde DB VPS                  | `yarn vps:db:backup`                                         |
| Lister / télécharger configuration | `yarn vps:backup:list` / `yarn vps:backup:download`          |
| Lister / télécharger DB            | `yarn vps:db:backup:list` / `yarn vps:db:backup:download`    |

Les téléchargements arrivent par défaut dans `backups/vps/`. Selon configuration,
la sauvegarde inclut archive de configuration, dump PostgreSQL et archive du volume
`openg7-sponsor-logos`. Noms, restauration ciblée et vérifications :
[sauvegarde](docker-deployment.md#backup), [restauration](docker-deployment.md#restore).
Une restauration est une opération distincte exigeant sauvegarde et instruction explicite.

## Debug, sécurité et nettoyage

Commencer par état/logs ciblés et `yarn services:check`; compléter par la
[recette OIDC](operations/admin-identity-and-alerts.md) pour ce mode.
`bash scripts/check.sh` et `bash scripts/security-check.sh` concernent les contrôles
d'exploitation, pas la suite unitaire locale. Examiner cible et effets avant exécution.

Le nettoyage Docker (`docker container prune`, `docker image prune`,
`docker system prune`) peut affecter d'autres projets : inventorier les ressources
et obtenir l'instruction destructive explicite. Ne jamais supprimer implicitement
les volumes de production.

Pare-feu Ubuntu, dashboard local et anti-abus : [sécurité Docker/VPS](docker-deployment.md#security).
Une modification réseau exige la procédure à risque élevé; préserver l'accès SSH
et n'exposer que les ports publics nécessaires.
