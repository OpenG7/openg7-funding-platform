# Sauvegarde et récupération sur une cible dédiée

Le scénario 66 utilise les vrais scripts de sauvegarde/restauration, avec des
données synthétiques. Une recette locale n'autorise aucune opération de production.

## Créer un ensemble cohérent

Prérequis : Bash, Node 22, Docker Compose et l'image `postgres:16-alpine`.
Identifier l'environnement, la révision et les digests API/Web. Prévoir l'espace,
un emplacement protégé hors serveur et une rétention adaptée avant la sauvegarde.
Le script ne chiffre ni ne transfère les archives et ne supprime aucun historique.

Pour une récupération DB **et** médias cohérente, arrêter les écritures applicatives,
workers et téléversements pendant toute la capture. `pg_dump` fournit un snapshot
PostgreSQL cohérent, mais ne synchronise pas les fichiers ou les fournisseurs.
Le script de sauvegarde n'arrête pas les services à la place de l'opérateur.

```sh
bash scripts/backup.sh
```

Les archives de configuration, dump SQL et volume de médias partagent leur
horodatage. Le fichier adjacent à la configuration, `*.tar.gz.manifest.json`,
est écrit seulement après réussite de la capture : version, date UTC,
environnement, base, pilote des médias, nom, taille et SHA-256 de chaque fichier.
L'absence de manifeste signifie que l'ensemble n'est pas terminé. Un verrou
empêche deux sauvegardes simultanées dans le même répertoire; après interruption
brutale, vérifier qu'aucune capture ne tourne avant de retirer ce verrou.

Le répertoire est privé (`0700`), les fichiers et temporaires également (`0600`).
La configuration contient des secrets et la base des données privées : conserver
l'ensemble sous contrôle d'accès. Les empreintes détectent une corruption ou un
mélange de captures; elles n'authentifient pas un expéditeur malveillant.
N'utiliser que des archives de confiance.

Avec le pilote `local`, un volume de médias absent fait échouer la capture.
Avec `ovh-s3`, le dump et la configuration ne sauvegardent pas les objets S3.
La restauration ci-dessous refuse ce pilote : préparer séparément la copie des
objets, leurs versions, politiques et métadonnées selon le
[runbook de stockage](ovh-object-storage.md).

`yarn vps:backup:download` télécharge la configuration, son manifeste et les
artéfacts DB/médias présents du **même horodatage**. Le téléchargement DB seul
reste disponible pour une investigation, mais ne constitue pas un ensemble complet.

## Restaurer sans remplacer la source

Préparer une machine/cible isolée et un checkout de confiance, compatible avec
le schéma et les images de la capture. Ce checkout doit être sans `.env`; le
nom de projet, ses volumes et ses réseaux doivent être neufs. Les identifiants
de ressources restaurées sont dérivés de `--target-project` et inscrits dans le
nouveau `.env`. Les valeurs par défaut de Compose restent celles des installations
existantes; ne pas renommer leurs volumes pendant une livraison ordinaire.

Après l'autorisation explicite de l'opération et vérification de ses sauvegardes :

```sh
bash scripts/restore-from-backup.sh \
  --target-project openg7-recovery-20260925 \
  --config-backup /archives/openg7-backup-20260925T020000Z.tar.gz \
  --database-dump /archives/openg7-funding-db-20260925T020000Z.sql \
  --sponsor-logos-backup /archives/openg7-sponsor-logos-20260925T020000Z.tar.gz
```

Le manifeste doit accompagner le fichier de configuration avec le suffixe
`.manifest.json`. Les anciens ensembles sans manifeste ne sont pas acceptés par
ce flux : une empreinte calculée après coup ne prouve pas leur intégrité passée.
La confirmation saisie est `RESTORE <nom-du-projet>`; `--force` omet seulement
cette saisie, jamais les vérifications.

Avant toute création de service, le script vérifie les empreintes, les chemins et
types d'entrées des archives, l'absence de cible existante et les ressources Compose.
Un verrou du checkout et une réservation Docker empêchent deux restaurations
simultanées d'utiliser la même cible. Après un arrêt brutal, vérifier l'absence
d'opération active avant de libérer ces verrous.
Les liens symboliques/physiques et fichiers spéciaux sont refusés. Il restaure le
`.env`, Compose et Traefik; les scripts archivés ne sont jamais exécutés ni installés.
Les images, le code et les autres fichiers du checkout doivent correspondre à la
révision préparée. Une archive de configuration ne contient pas les images Docker.

Seul PostgreSQL démarre. L'import inclut schéma et données dans une transaction
avec arrêt à la première erreur. Aucun runner de migration n'est exécuté :
voir sa [limite sur une base existante](database-migrations.md#limite-actuelle-sur-une-base-existante).
Les médias sont ensuite extraits vers le nouveau volume. Aucun ancien volume
n'est supprimé. Si une étape échoue, API/Web restent arrêtés; conserver le diagnostic
et préparer une autre cible neuve. Nettoyer une cible ratée exige une opération
explicite limitée à ses ressources.

## Vérifier avant remise en service

1. Comparer tables, contraintes, séquences, montants par devise, frais,
   remboursements, factures/avoirs et PDF avec les preuves de la capture.
2. Vérifier médias privés/publics, consentements, revue, brouillons de suivi,
   approbations, audit et accès administratifs. Une restauration peut réintroduire
   des sessions ou droits révoqués depuis la capture : les rapprocher de l'état
   actuel avant d'exposer l'administration. Conserver OIDC/MFA en production.
3. Réconcilier Stripe, courriels et publications avec les fournisseurs **avant**
   de reprendre les files. Un message encore en attente dans la sauvegarde peut
   avoir déjà été livré depuis. Un résultat incertain n'autorise pas un renvoi.
4. Adapter domaines, ports, certificats et accès de la cible; contrôler les images
   et les sorties réseau. L'override persistant du moteur social peut primer sur
   sa variable d'environnement. API arrêtée reste la barrière pendant l'investigation.
   Pour une inspection applicative isolée après ce rapprochement, le nouveau
   `FUNDING_EMAIL_WORKER_ENABLED=false` préserve la file au démarrage. Il ne bloque
   pas les commandes d'envoi explicites ni les autres workers : leurs réglages et
   les sorties réseau doivent aussi être maîtrisés avant activation.
5. Après autorisation distincte de remise en service, démarrer les services requis,
   vérifier santé, UI publique/admin et traitements choisis, puis effectuer la bascule.
   Garder la source préservée et consigner le résultat et le retour possible.

Le script ne redémarre plus automatiquement la pile et n'exécute plus
`scripts/check.sh`. L'ancien `--skip-check` est retiré. Le démarrage applicatif,
les contrôles de production et la bascule sont des étapes distinctes.

<a id="recette-locale-automatisee"></a>

## Recette locale automatisée

```sh
yarn build
yarn workspace @openg7/funding-web build
docker pull postgres:16-alpine
yarn exec playwright test --config tests/playwright-recovery.config.mjs
```

La recette construit une image API de la révision courante, sert le Web compilé,
crée des projets Docker à noms uniques et n'utilise ni `.env` du workspace, ni
base existante, ni fournisseur externe. Les seuls ports de test sont sur loopback;
le PostgreSQL du Compose de production reste privé. Les fixtures sont arrêtées
et supprimées après le test. Les preuves sont dans `test-results/recovery/`.

La qualification couvre le stockage local et une connexion admin par session
signée en mode token. Elle ne qualifie pas OIDC externe, DNS/HTTPS, délivrabilité,
objets/politiques OVH, rapprochement Stripe réel, ni restauration intégrale d'un VPS.
