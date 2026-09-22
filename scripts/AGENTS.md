# Consignes des scripts et de l'exploitation

Portée : `scripts/**`; spécialisation métier du standard OpenG7.

Complète le [socle du dépôt](../AGENTS.md). Lire ces règles aussi pour Docker,
Traefik, CI/CD ou l'outil `apps/production-launch-agent`, puis le runbook concerné.

## Scripts

- Mode non destructif ou dry-run lorsque possible; variables requises validées,
  erreurs explicites, sortie non nulle sur échec, aucune impression de secret.
- Compatibilité Linux, fins de ligne normalisées avant chargement de `.env`,
  racine vérifiée ou chemins absolus pour les opérations de production.
- Dépendances dans le workspace utilisateur; pas de nouveau package trivial,
  ni de désactivation TLS/CORS/CSRF/signature pour contourner une erreur.
- Pour Stripe live, confirmer compte/clé sans afficher de secret, borner dates et
  volume, commencer par dry-run s'il existe, vérifier et permettre la reprise.
  Les commandes `:live`, `prod:*`, `vps:*` ne sont pas exécutées automatiquement
  pendant une tâche de code ou une PR.

## Topologie et santé

Traefik expose 80/443; Web rejoint `edge`, API `edge` et `data`, PostgreSQL seulement
le réseau interne `data`. L'API seule reçoit `DATABASE_URL`; dashboards techniques
sur `127.0.0.1` par défaut. Aucun port PostgreSQL public ou routage DB par Traefik.
Préserver `/health` Web/API, santé Traefik, `pg_isready`, délais réalistes et
`service_healthy` lorsque nécessaire. Valider Compose avec
`docker compose config --quiet` pour ne pas afficher les secrets interpolés.

## Déploiement, sauvegarde et restauration

Lire [Docker/VPS](../docs/docker-deployment.md) et les
[migrations](../docs/operations/database-migrations.md) avant une opération.
La production est sous `/opt/openg7-funding-platform`; vérifier `git status --short`
et `docker compose ps` depuis cette racine. Aucun `docker compose down -v` en
production ni suppression de volume sans instruction explicite.

Avant déploiement : révision/images identifiées, validations réussies, environnement
protégé, sauvegarde vérifiée lorsque requise, espace disponible, healthchecks et
retour préparés. Après : état des services, santé, logs sûrs, HTTPS, transparence,
Checkout dans le mode autorisé et admin sans fuite. Consigner le résultat.

Chaque sauvegarde précise date, environnement, base, format, taille, checksum
lorsque disponible, rétention et emplacement protégé. Sauvegarder les médias
avec leurs métadonnées; une DB restaurée seule ne restaure pas ses objets.

Avant restauration : cible explicite, sauvegarde de l'état actuel, arrêt des
écritures ou maintenance, compatibilité, essai isolé si possible, commande exacte
et instruction explicite. Après : migrations nécessaires, contraintes, totaux,
réconciliation Stripe, admin et compte rendu. Un simple démarrage ne suffit pas.

Un rollback vise des images/révisions connues : documenter avant/après, raison,
migrations appliquées, compatibilité DB et vérifications. Il ne restaure pas
implicitement la DB et doit conserver une possibilité de migration en avant.

## Validation

Appliquer la [matrice commune](../docs/development/validation.md) : syntaxe shell,
contrôles statiques, Compose et healthchecks ciblés. Les procédures de
[smoke test](../docs/operations/production-smoke-tests.md) et de
[recette isolée](../docs/operations/integration-rehearsal.md) précisent les cibles
et effets. La CI ordinaire ne déploie, rembourse, restaure ou utilise aucun secret
de production. Une commande d'envoi reste un effet réel, même appelée « test ».
