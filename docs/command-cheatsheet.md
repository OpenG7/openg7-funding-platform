# Aide-mémoire des commandes

## Commandes les plus courantes

Usage quotidien local :

| Besoin                          | Commande                                   |
| ------------------------------- | ------------------------------------------ |
| Installer les dépendances       | `corepack enable && corepack yarn install` |
| Lancer le site et l'API         | `yarn dev`                                 |
| Vérifier le build TypeScript    | `yarn build`                               |
| Builder le frontend Angular     | `yarn workspace @openg7/funding-web build` |
| Lancer le lint                  | `yarn lint`                                |
| Mettre à jour Docker localement | `yarn docker:update`                       |

Les raccourcis `docker:*` et `db:*` locaux attendent que Docker soit prêt.
Si Docker Desktop est fermé, ils tentent de l'ouvrir et affichent un message
`Patientez pendant l'ouverture de Docker...` avant de continuer.

Usage courant VPS :

| Besoin                                      | Commande                     |
| ------------------------------------------- | ---------------------------- |
| Mettre à jour le VPS et déployer            | `yarn vps:update`            |
| Déployer sans refaire `git pull`            | `yarn vps:deploy`            |
| Déployer sans rebuild Docker local au VPS   | `yarn vps:update --no-build` |
| Revenir aux images applicatives précédentes | `yarn vps:rollback`          |
| Vérifier la production                      | `yarn vps:check`             |
| Voir les containers                         | `yarn vps:ps`                |
| Suivre les logs                             | `yarn vps:logs`              |
| Suivre les logs API                         | `yarn vps:logs api`          |
| Ouvrir un shell dans le projet sur le VPS   | `yarn vps:ssh`               |

Usage courant PostgreSQL sur le VPS :

| Besoin                                       | Commande                      |
| -------------------------------------------- | ----------------------------- |
| Appliquer les migrations après un `git pull` | `yarn vps:db:update`          |
| Appliquer les migrations sans déployer l'app | `yarn vps:db:migrate`         |
| Ouvrir `psql` sur la base du VPS             | `yarn vps:db:psql`            |
| Créer un backup DB sur le VPS                | `yarn vps:db:backup`          |
| Créer et télécharger un backup DB            | `yarn vps:db:backup:download` |
| Créer et télécharger un backup config        | `yarn vps:backup:download`    |

Les raccourcis `vps:*` lisent `VPS_HOST`, `VPS_USER`, `VPS_PORT`,
`VPS_APP_DIR` et `VPS_BACKUP_DOWNLOAD_DIR` depuis l'environnement ou `.env`.
Sans clé SSH configurée, `ssh` demande le mot de passe dans le terminal.

## Local

Installer les dépendances :

```bash
corepack enable
corepack yarn install
```

Lancer le site + API en développement :

```bash
corepack yarn dev
```

Build de validation :

```bash
corepack yarn build
corepack yarn workspace @openg7/funding-web build
```

Lint :

```bash
corepack yarn lint
```

## Docker Compose

Démarrer toute la stack :

```bash
yarn docker:up
```

Ce raccourci ouvre Docker Desktop au besoin, attend que Docker soit prêt, puis
lance `docker compose up --build`.

Mettre a jour Docker avec les questions guidees :

```bash
yarn docker:update
```

Ce raccourci attend aussi Docker Desktop avant de lancer les questions guidees.

En developpement, lancer aussi le listener Stripe apres la mise a jour :

```bash
yarn docker:update --development --stripe-webhook
```

Garder les anciennes images Docker dangling apres un rebuild :

```bash
yarn docker:update --no-prune-images
```

Nettoyer les anciennes images Docker dangling sans question :

```bash
yarn docker:update --prune-images
```

Arrêter :

```bash
yarn docker:down
```

Redémarrer un service :

```bash
docker compose restart web
docker compose restart api
docker compose restart traefik
```

Rebuild forcé du frontend :

```bash
docker compose stop web
docker compose rm -f web
docker image rm openg7-funding-web:local || true
docker compose build --no-cache web
docker compose up -d web
```

Rebuild forcé de l’API :

```bash
docker compose stop api
docker compose rm -f api
docker image rm openg7-funding-api:local || true
docker compose build --no-cache api
docker compose up -d api
```

Voir l’état :

```bash
docker compose ps
```

Voir les logs :

```bash
docker compose logs -f
docker compose logs -f web
docker compose logs -f api
docker compose logs -f traefik
```

Voir la configuration Compose finale :

```bash
docker compose config
```

## URLs

Production :

```text
https://openg7.org
```

Local via Traefik :

```text
https://localhost
```

Webhook Stripe :

```text
https://openg7.org/api/stripe/webhook
```

Ecouter les webhooks Stripe locaux :

```bash
corepack yarn stripe:webhook:listen
```

Rejouer un ou plusieurs evenements Stripe echoues en mode test :

```bash
corepack yarn stripe:events:resend evt_1TsrBoCWK41rMb2iwrzTtqRg evt_1TsmxRCWK41rMb2iWywWcofZ
```

Previsualiser sans envoyer :

```bash
corepack yarn stripe:events:resend evt_1... evt_2... --dry-run
```

Rejouer en production en ciblant le webhook Stripe exact :

```bash
corepack yarn stripe:events:resend:live evt_1... evt_2... --endpoint we_...
```

Endpoint public transparence :

```text
https://openg7.org/api/public/fund-transparency
```

## Tests rapides

Tester le frontend local :

```bash
curl -kI https://localhost
curl -kI https://localhost/health
```

Tester l’API locale :

```bash
curl -k https://localhost/api/public/fund-transparency
```

Tester la production :

```bash
curl -I https://openg7.org
curl -I https://openg7.org/health
curl https://openg7.org/api/public/fund-transparency
```

Validation complète :

```bash
bash scripts/check.sh
```

## Traefik

Recharger Traefik :

```bash
docker compose restart traefik
```

Logs Traefik :

```bash
docker compose logs --tail=200 traefik
docker compose logs -f traefik
```

Dashboard local Traefik :

```bash
ssh -L 8081:127.0.0.1:8081 "${VPS_USER:-ubuntu}@${VPS_HOST}"
```

Puis ouvrir :

```text
http://127.0.0.1:8081/dashboard/
```

## Certificat HTTPS

Vérifier le certificat :

```bash
echo | openssl s_client -servername openg7.org -connect openg7.org:443 2>/dev/null | openssl x509 -noout -issuer -subject -dates
```

Forcer une vérification renouvellement :

```bash
bash scripts/renew-certs.sh
```

Voir le fichier ACME :

```bash
ls -lah traefik/acme/
```

## Déploiement VPS

Depuis le poste local, mettre à jour le code sur le VPS puis déployer :

```bash
yarn vps:update
```

Même opération, mais sans rebuild si les images sont déjà disponibles :

```bash
yarn vps:update --no-build
```

Relancer seulement le script de déploiement déjà présent sur le VPS :

```bash
yarn vps:deploy
```

Vérifier l'état de production après un déploiement :

```bash
yarn vps:check
```

Revenir aux images applicatives précédentes :

```bash
yarn vps:rollback
```

Ce rollback utilise les tags Docker créés avant le dernier déploiement :

```text
openg7-funding-web:rollback
openg7-funding-api:rollback
```

Il ne restaure pas la base de données. Si une migration PostgreSQL incompatible a
été appliquée, restaurer un backup DB séparément.

Voir les containers et les logs depuis le poste local :

```bash
yarn vps:ps
yarn vps:logs
yarn vps:logs api
yarn vps:logs web
yarn vps:logs traefik
```

Ouvrir un shell directement dans le dossier du projet sur le VPS :

```bash
yarn vps:ssh
```

Première installation :

```bash
sudo bash scripts/install-vps.sh
cp .env.example .env
nano .env
bash scripts/deploy.sh
```

Déployer une mise à jour :

```bash
git pull
bash scripts/deploy.sh
```

Déployer sans rebuild local, avec images déjà publiées :

```bash
bash scripts/deploy.sh --no-build
```

## Sauvegardes

Créer une sauvegarde de configuration sur le VPS :

```bash
yarn vps:backup
```

Créer et télécharger une sauvegarde de configuration depuis le VPS :

```bash
yarn vps:backup:download
```

Créer une sauvegarde PostgreSQL sur le VPS :

```bash
yarn vps:db:backup
```

Créer et télécharger une sauvegarde PostgreSQL depuis le VPS :

```bash
yarn vps:db:backup:download
```

Les sauvegardes téléchargées depuis le VPS arrivent par défaut dans :

```text
backups/vps/
```

Appliquer toutes les migrations SQL dans l'ordre :

```bash
yarn db:migrate
```

Les migrations doivent etre des fichiers `.sql` dans :

```text
apps/funding-api/migrations/
```

Créer une sauvegarde :

```bash
yarn db:backup
```

Si `DATABASE_URL` est configure, ce script cree aussi :

```text
backups/openg7-funding-db-YYYYMMDDTHHMMSSZ.sql
```

Si le volume Docker `openg7-sponsor-logos` existe, le script cree aussi :

```text
backups/openg7-sponsor-logos-YYYYMMDDTHHMMSSZ.tar.gz
```

Lister les sauvegardes :

```bash
ls -lah backups/
```

Restaurer :

```bash
yarn db:restore --config-backup backups/openg7-backup-YYYYMMDDTHHMMSSZ.tar.gz --database-dump backups/openg7-funding-db-YYYYMMDDTHHMMSSZ.sql --sponsor-logos-backup backups/openg7-sponsor-logos-YYYYMMDDTHHMMSSZ.tar.gz
```

Équivalent direct :

```bash
bash scripts/restore-from-backup.sh \
  --config-backup backups/openg7-backup-YYYYMMDDTHHMMSSZ.tar.gz \
  --database-dump backups/openg7-funding-db-YYYYMMDDTHHMMSSZ.sql \
  --sponsor-logos-backup backups/openg7-sponsor-logos-YYYYMMDDTHHMMSSZ.tar.gz
```

## Debug fréquent

Container qui redémarre :

```bash
docker compose ps
docker compose logs --tail=100 web
docker compose logs --tail=100 api
docker compose logs --tail=100 traefik
```

Vérifier que Nginx a la bonne config dans l’image :

```bash
docker compose exec web cat /etc/nginx/conf.d/default.conf
```

Vérifier que l’API voit les variables :

```bash
docker compose exec api env | sort
```

Vérifier les routes Traefik déclarées :

```bash
docker compose exec traefik cat /etc/traefik/dynamic.yml
```

Nettoyer les containers arrêtés :

```bash
docker container prune
```

Nettoyer les images inutilisées :

```bash
docker image prune
```

Nettoyer prudemment tout ce qui est inutilisé :

```bash
docker system prune
```

## Sécurité et anti-abus

Lancer le contrôle sécurité :

```bash
bash scripts/security-check.sh
```

Voir les connexions et erreurs côté Traefik :

```bash
docker compose logs --tail=300 traefik
```

Voir les requêtes qui touchent l’API :

```bash
docker compose logs --tail=300 api
```

Redémarrer uniquement le proxy après modification Traefik :

```bash
docker compose restart traefik
```

Limiter le pare-feu aux ports publics essentiels sur Ubuntu :

```bash
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
sudo ufw status verbose
```

En cas de pic suspect :

```bash
docker stats
docker compose ps
docker compose logs --tail=200 traefik
docker compose logs --tail=200 api
```

Vérifier que le dashboard Traefik et cAdvisor restent locaux :

```bash
docker compose ps
curl -I http://127.0.0.1:8081/dashboard/
curl -I http://127.0.0.1:8082/
```
