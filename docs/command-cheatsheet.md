# Aide-mémoire des commandes

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
docker compose up -d --build
```

Mettre a jour Docker avec les questions guidees :

```bash
yarn docker:update
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
docker compose down
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
ssh -L 8081:127.0.0.1:8081 ubuntu@vps-8db0cb49.vps.ovh.ca
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

Lister les sauvegardes :

```bash
ls -lah backups/
```

Restaurer :

```bash
yarn db:restore --config-backup backups/openg7-backup-YYYYMMDDTHHMMSSZ.tar.gz --database-dump backups/openg7-funding-db-YYYYMMDDTHHMMSSZ.sql
```

Équivalent direct :

```bash
bash scripts/restore-from-backup.sh \
  --config-backup backups/openg7-backup-YYYYMMDDTHHMMSSZ.tar.gz \
  --database-dump backups/openg7-funding-db-YYYYMMDDTHHMMSSZ.sql
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
