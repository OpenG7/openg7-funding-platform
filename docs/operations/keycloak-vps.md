# Keycloak sur le VPS OpenG7

Ce runbook prépare un fournisseur OIDC sur le même VPS que l'application.
L'activation est explicite ; préparer les fichiers ne déploie aucun service.
Les droits, sessions et confirmations OpenG7 restent décrits dans le
[runbook des accès](admin-identity-and-alerts.md).

## Cible, ressources et préconditions

La cible prévue dispose de 4 vCPU, 8 Go de RAM, 75 Go NVMe et 400 Mbit/s.
L'overlay [docker-compose.identity.yml](../../docker-compose.identity.yml)
ajoute `keycloak` et `identity-postgres`, avec une base et un volume distincts
de PostgreSQL Funding. Seul Keycloak rejoint le réseau du proxy ; sa DB reste
sur `identity-data`, interne. Aucun port hôte 8080, 9000 ou 5432 n'est publié.
[traefik/keycloak.yml](../../traefik/keycloak.yml) route l'hôte d'identité HTTPS,
y compris la console, vers le service Keycloak. La console conserve son
authentification Keycloak ; aucune restriction réseau supplémentaire n'est
livrée ici. Les endpoints de gestion du port 9000 ne passent pas par Traefik.

Les plafonds mémoire sont 2 Gio pour Keycloak et 512 Mio pour sa DB. Avec les
1,75 Gio de la pile Compose de base, cela représente 4,25 Gio de plafonds,
hors surveillant d'alertes optionnel, système, caches et builds. Leurs plafonds
CPU sont respectivement 1 et 0,5 vCPU. Ce calcul
n'est pas une mesure de consommation ou de charge admissible. La
[documentation conteneur Keycloak](https://www.keycloak.org/server/containers#_specifying_different_memory_settings)
recommande 2 Go pour une petite installation de production et adapte le tas
Java à la limite du conteneur. Vérifier mémoire disponible, espace libre,
croissance DB/logs/sauvegardes et temps de connexion avant activation ; une
panne du VPS affectera simultanément l'application et son fournisseur.

Avant toute opération sur une cible réelle :

1. Identifier le VPS, la révision, les images, l'opérateur et la fenêtre autorisée.
   Depuis `/opt/openg7-funding-platform`, vérifier `git status --short`,
   `df -h`, `free -h` et l'état Docker. Préparer les sauvegardes applicative
   **et identité**, une destination hors VPS et un retour compatible.
2. Créer l'enregistrement DNS de `auth.openg7.org` vers le VPS. Un AAAA ne doit
   être conservé que si IPv6 dessert effectivement cet hôte. Vérifier résolution,
   pare-feu et accès 80/443 pour Traefik/ACME. Aucune exception TLS ni port DB public.
3. Utiliser les versions déclarées par le
   [Dockerfile Keycloak](../../docker/keycloak/Dockerfile), PostgreSQL et Traefik.
   Une mise à jour d'image requiert sa recette et sa sauvegarde : ne pas remplacer
   un tag par `latest` ni revenir à une ancienne image après migration de sa DB.

## Configuration et démarrage séparé

Éditer `.env` avec un outil local protégé, permissions `600`, sans copier son
contenu dans un ticket, un log ou Git. Valeurs publiques de la cible prévue :

```env
FUNDING_KEYCLOAK_ENABLED=true
FUNDING_KEYCLOAK_HOSTNAME=auth.openg7.org
FUNDING_ADMIN_AUTH_MODE=oidc
FUNDING_PUBLIC_BASE_URL=https://openg7.org
FUNDING_ADMIN_OIDC_ISSUER=https://auth.openg7.org/realms/openg7
FUNDING_ADMIN_OIDC_CLIENT_ID=openg7-funding-admin
FUNDING_ADMIN_OIDC_MFA_ACR=
```

L'origine publique doit être exacte, sans chemin ni slash final et distincte
de l'hôte Keycloak. Ne pas combiner l'activation gérée avec `COMPOSE_FILE` ;
les fichiers d'une composition personnalisée doivent être sélectionnés
explicitement. Renseigner
séparément `FUNDING_KEYCLOAK_DB_PASSWORD`,
`FUNDING_KEYCLOAK_BOOTSTRAP_ADMIN_USERNAME`,
`FUNDING_KEYCLOAK_BOOTSTRAP_ADMIN_PASSWORD` et
`FUNDING_ADMIN_OIDC_CLIENT_SECRET`. Les trois mots de passe/secrets doivent
être distincts, aléatoires et d'au moins 32 caractères ; aucun défaut n'est
fourni. Garder également les préconditions API du runbook des accès : DB
Funding migrée, secret de session et clé de chiffrement privée. Les subjects
propriétaires seront renseignés après création des personnes nominatives.

Les commandes ci-dessous décrivent une opération à exécuter seulement sur la
cible autorisée. Le préflight lit `.env` à la racine ; l'environnement du
processus reste prioritaire. Le lecteur commun des commandes Docker utilise
Compose pour résoudre les références, guillemets et commentaires du fichier,
selon sa [syntaxe d'interpolation](https://docs.docker.com/compose/how-tos/environment-variables/variable-interpolation/).
La sortie de configuration est capturée et seuls les réglages nécessaires au
plan sont examinés. Ces valeurs ne sont pas exportées dans l'environnement des
commandes suivantes : Compose conserve la résolution des variables runtime.
Docker Compose doit être installé pour lire un fichier d'environnement, y compris
en `--dry-run` ; cette lecture ne contacte ni le daemon ni le fournisseur et ne
démarre aucun service. Le préflight n'imprime aucune valeur privée :

```sh
node scripts/keycloak-config.mjs --check
docker compose --env-file .env -f docker-compose.yml -f docker-compose.identity.yml config --quiet
docker compose --env-file .env -f docker-compose.yml -f docker-compose.identity.yml build keycloak
docker compose --env-file .env -f docker-compose.yml -f docker-compose.identity.yml up -d --wait identity-postgres keycloak traefik
docker compose --env-file .env -f docker-compose.yml -f docker-compose.identity.yml ps identity-postgres keycloak traefik
```

Ne démarrer l'API en production qu'après qualification du fournisseur et des
comptes. `docker:up` et `docker:update` partagent la sélection des fichiers Compose
et ajoutent l'overlay identité lorsque le commutateur est `true`. Si
`FUNDING_OPERATIONS_WATCHER_ENABLED=true`, ils conservent aussi l'overlay
`docker-compose.operations.yml` et son surveillant. La livraison applicative et son rollback conservent
l'overlay pour Traefik, mais ne reconstruisent, ne démarrent ni ne restaurent
implicitement les services d'identité : leur cycle reste séparé.
`docker:update` refuse le commutateur `false` tant qu'un conteneur identité du
projet existe, même arrêté ou en redémarrage. Garder `true` pendant une panne.
Une désactivation autorisée exige d'abord l'arrêt puis le retrait explicite des
conteneurs `keycloak` et `identity-postgres` avec l'overlay sélectionné ; conserver
leurs volumes et préparer le fournisseur de remplacement. Le commutateur ne
désactive pas les exigences OIDC/MFA de l'API. La mise à jour refuse également
de retirer implicitement un conteneur `operations` existant. Pour une composition
personnalisée sans identité gérée, elle vérifie que le service figure dans les
fichiers sélectionnés avant d'autoriser la mise à jour.

Traefik termine HTTPS ; Keycloak reçoit HTTP sur le réseau Docker avec hostname
HTTPS fixé et en-têtes du proxy. Vérifier les redirections, cookies et origine
selon le [guide du reverse proxy](https://www.keycloak.org/server/reverseproxy).
Le certificat d'identité doit être valide avant la première connexion.

## Realm, MFA et premiers propriétaires

Le [realm importé](../../docker/keycloak/openg7-realm.json) crée `openg7` et un
client confidentiel dont ID, secret et callback proviennent de l'environnement.
Le callback prévu est exactement `https://openg7.org/api/admin/auth/callback`,
sans wildcard. L'import ne crée aucun utilisateur ni administrateur applicatif.
Au redémarrage, un realm déjà présent est conservé : modifier le JSON Git ne
met pas à jour sa configuration. Examiner l'état existant et appliquer toute
évolution séparément, après sauvegarde ; ne pas forcer un réimport écrasant.
Voir les [règles d'import Keycloak](https://www.keycloak.org/server/importExport).

Le flow `openg7-password-otp` exige mot de passe puis OTP, sans alternative
Cookie ou fournisseur externe. Le mapper natif `oidc-amr-mapper` produit le
claim signé de l'ID token à partir des authentificateurs réellement exécutés.
OpenG7 exige `amr` contenant `mfa`. Le préflight impose
`FUNDING_ADMIN_OIDC_MFA_ACR` vide pour ce profil ;
aucun claim constant `mfa`, ACR arbitraire ou relâchement serveur n'est admissible.

1. Ouvrir `https://auth.openg7.org/admin/` et utiliser le compte bootstrap
   temporaire du realm `master`. Créer un administrateur Keycloak nominatif,
   lui attribuer les droits nécessaires, exiger son enrôlement OTP et vérifier
   une nouvelle connexion avec les deux facteurs avant de quitter le bootstrap.
2. Créer les personnes OpenG7 dans le realm `openg7`, avec mot de passe propre
   et enrôlement OTP. Conserver leurs identifiants utilisateur/`sub` dans un
   registre d'accès protégé ; un email ou un nom n'est pas un subject OIDC.
3. Définir `FUNDING_ADMIN_OIDC_OWNER_SUBJECTS` avec les subjects vérifiés des
   premiers propriétaires, puis effectuer la livraison API autorisée. Les
   rôles lecteur/opérateur/propriétaire sont contrôlés et persistés par l'API
   OpenG7, pas déduits des rôles Keycloak. Ajouter les autres comptes depuis
   **Accès et sessions**, selon le runbook propriétaire.
4. Si la connexion utilisée pour enrôler OTP est refusée par OpenG7, ouvrir une
   nouvelle connexion complète mot de passe + OTP. L'enrôlement seul ne prouve
   pas l'exécution du second facteur pour l'ID token courant. Vérifier les
   claims dans une recette protégée, sans publier ni journaliser le token.
5. Après validation de l'administrateur permanent, supprimer le compte bootstrap
   dans Keycloak. Les variables bootstrap restent requises par Compose et
   protégées dans `.env` ; elles ne recréent pas ce compte dans un realm existant.

Les opérations console modifient une identité réelle : elles requièrent la
cible et l'autorisation correspondantes. Ne pas recopier les claims privés ou
credentials dans les preuves. La [documentation d'administration](https://www.keycloak.org/docs/latest/server_admin/index.html)
reste la référence pour gérer comptes, OTP et sessions du fournisseur.

## Rotation des credentials sur un realm existant

Modifier `.env` ou reconstruire l'image ne met à jour ni le client déjà
persisté dans Keycloak ni le mot de passe PostgreSQL d'un volume existant.
Préparer une rotation autorisée, une sauvegarde identité vérifiée, une session
console nominative avec MFA et une fenêtre de reprise avant ces opérations.

Pour le secret client OIDC :

1. Dans la console, sélectionner le realm `openg7`, le client existant puis
   **Credentials**. Régénérer son secret et transférer la nouvelle valeur
   directement vers `FUNDING_ADMIN_OIDC_CLIENT_SECRET` dans `.env` protégé,
   sans sortie terminal, historique shell ou copie dans Git.
2. Valider la configuration puis recréer uniquement l'API pour actualiser son
   environnement et sa configuration OIDC mise en cache :

   ```sh
   node scripts/keycloak-config.mjs --check
   docker compose --env-file .env -f docker-compose.yml -f docker-compose.identity.yml up -d --no-deps --force-recreate api
   ```

3. Vérifier une nouvelle connexion avec OTP, le refus sans MFA et les accès
   applicatifs. Les deux configurations doivent être coordonnées : changer
   seulement le secret côté API provoque un refus d'échange de code. Revenir
   à l'ancienne valeur exige qu'elle soit encore valide côté fournisseur ;
   sinon corriger la configuration en avant. Ne pas supprimer ou réimporter
   le realm pour effectuer cette rotation.

Pour le mot de passe DB, arrêter explicitement Keycloak pendant la maintenance,
changer le credential du rôle `openg7_identity` sur `identity-postgres`, puis
mettre à jour `FUNDING_KEYCLOAK_DB_PASSWORD` dans `.env` et recréer les deux
services identité. Utiliser un client SQL de confiance avec saisie protégée
(par exemple `\password openg7_identity` dans `psql`), jamais un mot de passe
dans un argument de commande ou un SQL enregistré dans l'historique. Vérifier
readiness DB/Keycloak puis connexion MFA. L'environnement `POSTGRES_PASSWORD`
ne change pas à lui seul un credential d'une DB déjà initialisée.

## Vérifications avant activation

- Vérifier le certificat et la discovery publique :
  `curl -fsS https://auth.openg7.org/realms/openg7/.well-known/openid-configuration`.
  L'issuer doit être exactement celui de l'API ; discovery et JWKS ne prouvent
  ni MFA ni rôle applicatif. Vérifier les services sains et leur consommation
  avec Compose et `docker stats --no-stream`, sans afficher l'environnement.
- Exercer connexion propriétaire avec OTP, refus sans MFA, subject inconnu,
  rôle lecteur et mutation interdite, expiration, révocation OpenG7 et nouvelle
  connexion. Contrôler confirmations/audit et absence de secret dans les logs.
- Couper uniquement le fournisseur sur une cible de recette autorisée : la
  nouvelle connexion doit échouer, sans repli vers le mode token. Les sessions
  OpenG7 déjà établies ont leur propre durée/révocation côté API ; arrêter
  Keycloak ne les révoque pas à lui seul.
- Vérifier que 8080, 9000 et 5432 n'ont aucun binding hôte, que la DB Funding
  reste distincte et que Checkout, Web et webhook conservent leurs routes.
  Ne pas effectuer de paiement live pour qualifier l'identité.

Consigner révision/images, cible, résultats et limitations, sans token, mot de
passe, cookie ou corps privé. Le [diagnostic des accès](admin-identity-and-alerts.md#diagnostic-de-configuration-avant-recette)
complète ces contrôles ; `yarn test:e2e:identity` utilise un fournisseur simulé
et ne qualifie pas cette installation Keycloak.

<a id="sauvegarde-identite"></a>

## Sauvegarde de la base identité

Les scripts de sauvegarde/restauration applicatifs ne capturent pas automatiquement
`identity-postgres` ni l'overlay et l'image Keycloak. Conserver leur révision et
leurs fichiers avec le plan de récupération. Sauvegarder cette DB séparément,
avant modification du realm,
mise à jour Keycloak ou restauration. Son dump contient identités, credentials
OTP, clés et secrets clients : le chiffrer avant écriture sur disque et conserver
une copie vérifiée hors VPS. Un export partiel de console n'est pas une sauvegarde
DB et ne remplace pas ce dump.

Depuis la racine vérifiée, avec `age` installé et un destinataire public validé
sur une station de récupération indépendante :

```sh
set -euo pipefail
umask 077
read -r -p 'Destinataire public age vérifié : ' KEYCLOAK_BACKUP_RECIPIENT
KEYCLOAK_BACKUP_PATH="$PWD/backups/keycloak-$(date -u +%Y%m%dT%H%M%SZ)-$$.dump.age"
mkdir -p "$PWD/backups"
test ! -e "$KEYCLOAK_BACKUP_PATH"
docker compose --env-file .env -f docker-compose.yml -f docker-compose.identity.yml exec -T identity-postgres \
  sh -c 'exec pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom --no-owner --no-acl' \
  | age -r "$KEYCLOAK_BACKUP_RECIPIENT" > "$KEYCLOAK_BACKUP_PATH.part"
mv -- "$KEYCLOAK_BACKUP_PATH.part" "$KEYCLOAK_BACKUP_PATH"
sha256sum "$KEYCLOAK_BACKUP_PATH" > "$KEYCLOAK_BACKUP_PATH.sha256"
```

Un échec du pipeline laisse éventuellement `.part` : ce fichier ne constitue
pas une sauvegarde terminée. Conserver date UTC, environnement, version
Keycloak/PostgreSQL, taille, checksum et emplacement protégé ; vérifier le
checksum après transfert. Le [format custom PostgreSQL](https://www.postgresql.org/docs/16/app-pgdump.html)
permet une restauration contrôlée. Sauvegarder aussi la configuration protégée
et les paramètres de proxy selon le [runbook applicatif](backup-recovery.md).
Garder la clé privée `age` hors VPS et tester périodiquement une restauration.

## Restauration isolée et repli

Restaurer d'abord dans un checkout compatible sur une cible dédiée : nouveau
nom de projet, DB vide, volume identité neuf, configuration de récupération
protégée et aucune connexion à la DB source. Le volume identité est scoped par
projet Compose. Ne démarrer ni Traefik, ni Keycloak, ni API pendant l'import.
Le fichier de récupération doit satisfaire Compose avec ses propres secrets ;
ne pas charger l'environnement de production par héritage.

Après vérification du checksum du dump, les commandes ci-dessous importent
uniquement dans la DB identité du projet explicitement nommé :

```sh
docker compose --project-name openg7-identity-recovery-20261005 \
  --env-file /secure/keycloak-recovery.env -f docker-compose.yml -f docker-compose.identity.yml \
  up -d --wait identity-postgres

set -euo pipefail
age --decrypt -i /secure/offline-recovery.agekey /secure/keycloak-backup.dump.age \
  | docker compose --project-name openg7-identity-recovery-20261005 \
      --env-file /secure/keycloak-recovery.env -f docker-compose.yml -f docker-compose.identity.yml \
      exec -T identity-postgres sh -c \
      'exec pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner --no-acl --exit-on-error --single-transaction'
```

La [restauration PostgreSQL](https://www.postgresql.org/docs/16/app-pgrestore.html)
est transactionnelle ici et ne nettoie aucune DB existante. Vérifier tables,
comptes, clés, clients et flow MFA sans imprimer leurs secrets. Les credentials
restaurés restent sensibles : garder la cible isolée, préparer son hostname,
issuer et client de recette avant toute ouverture. Une restauration DB réussie
ne vaut pas autorisation d'activer le fournisseur ou l'application.

Pour un repli réel, conserver une sauvegarde de l'état courant, préciser image
et DB compatibles, maintenance, révocations nécessaires et vérifications après
reprise. Le rollback applicatif ne restaure pas l'identité. En cas de panne,
réparer ou restaurer le fournisseur autorisé ; ne jamais activer le mode token
en production. Arrêter les seuls services concernés conserve les volumes ;
ne pas utiliser `down -v` ou supprimer la DB pour recréer les accès.

## Preuves et travail restant

Préparation locale du **5 octobre 2026**, branche `feat/keycloak-vps-identity` :
overlay optionnel, image optimisée 26.8.0, import du realm, route Traefik,
préflight et commandes de démarrage/livraison préparés. Les secrets DB et
bootstrap sont confinés aux services identité. Les mises à jour et rollbacks
applicatifs excluent la DB et l'image identité de leurs actions.

La revue a conduit à corriger le chargement brut de `.env` et l'omission du
surveillant dans la composition gérée. Le
[lecteur Docker](../../scripts/lib/docker-environment.mjs) est partagé par le
démarrage, la mise à jour et le préflight. La
[configuration Docker](../../scripts/lib/docker-config.mjs) porte la sélection
des overlays et les profils ; la
[validation Keycloak](../../scripts/lib/keycloak-config.mjs) reste limitée à
l'identité. La garde de mise à jour vérifie les conteneurs existants avant
toute commande susceptible de retirer des orphelins.

Validations de la préparation initiale, avant la correction et la consolidation
des lecteurs et de la sélection Compose, sous Node 22.23.3 :

- `yarn test` : 5 512 réussites, 1 test ignoré (`age` absent), aucun échec.
- Recette Keycloak réelle : 6 tests réussis, image optimisée saine, signature
  JWKS, nonce et PKCE vérifiés. Le mot de passe seul et l'OTP incorrect ne
  rendent aucun code ; l'OTP réussi produit `amr` contenant `mfa`. L'inscription
  OTP initiale sans authentification OTP est refusée par le handler API.
- Configuration, realm et livraison ciblés : 13 tests réussis, incluant secrets
  absents/réutilisés, ACR interdit, composition personnalisée et retrait implicite
  d'identité refusés. Compose est validé avec des valeurs synthétiques.
- Build de l'image, syntaxe des cinq scripts shell, format ciblé,
  `git diff --check` et standard OpenG7 réussis. `yarn lint` : aucune erreur,
  un avertissement préexistant dans `scripts/smoke-public.mjs`.
- `check-agent-docs` reste en échec sur les budgets préexistants de
  `docs/technical/admin-api.md` et `docs/technical/stripe.md`, hors changement.

Après correction et consolidation, le même jour sous Node 22.23.3 :
`yarn build` et **54 tests ciblés** réussis, sans test ignoré. Ils couvrent les
deux régressions, la sélection combinée des overlays, la parité Node/Bash,
les priorités shell/racine/projet personnalisé, les alias et dollars littéraux,
les erreurs sans fuite et les environnements transmis aux processus suivants.
Les rendus Compose sont exécutés avec des configurations synthétiques ; tous
les démarrages de services sont interceptés. La syntaxe des huit scripts Node,
le format ciblé et `git diff --check` passent. Aucun service réel n'a été modifié.
Les preuves de la préparation initiale ci-dessus restent datées de cette
préparation ; la recette Keycloak réelle n'a pas été relancée pour ces corrections.

Reproduire uniquement la recette locale, avec Docker Linux local disponible :

```sh
docker build -f docker/keycloak/Dockerfile -t openg7-keycloak:26.8.0-local .
docker pull postgres:16-alpine
yarn build
node --test tests/identity/keycloak-identity.integration.mjs
```

Cette recette est sélectionnée explicitement, hors glob d'intégration générique.
Elle utilise des réseaux uniques, une DB jetable en mémoire, des ports de boucle
locale et une exception HTTP locale ; les ressources sont nettoyées après usage.
Le callback utilise le handler OpenG7 réel avec une persistance injectée en mémoire,
sans qualifier ici sa persistance PostgreSQL complète ni le proxy HTTPS public.

Les contrôles de charge, la restauration isolée, l'administration du realm
`master` et la qualification DNS/HTTPS/MFA sur le VPS restent à exécuter sur la
cible autorisée. Aucun déploiement, compte réel ou changement DNS de production
n'a été exécuté dans ces travaux.
