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
Avec `ovh-s3`, le même artéfact média contient maintenant les objets courants des
deux buckets, leurs clés, rôles privé/public, type MIME, cache, métadonnées, ETag,
version observée et SHA-256. Le script utilise le SDK déjà installé par Yarn,
parcourt la pagination et relit l'inventaire avant de conclure. Garder les écritures
arrêtées : cette vérification ne rend pas atomiques PostgreSQL et S3. La capture
est bornée à 100 000 objets au total et les requêtes à 60 secondes.
Les versions historiques, marqueurs de suppression, politiques, ACL et règles
de rétention ne sont pas sauvegardés. Un échec garde le staging privé `.s3-*`
pour investigation et ne produit aucun manifeste d'ensemble terminé.

### Récupération des objets S3 en quarantaine

Préparer deux buckets dédiés vides, distincts des noms source, sans politique de
bucket ni ACL de groupe/public. Un fichier de configuration **cible** protégé
utilise les variables S3 du [runbook de stockage](ovh-object-storage.md).
Ne pas charger la configuration source pour cette opération.

```sh
node --env-file=/secure/recovery-s3.env scripts/storage-backup.mjs restore-archive \
  /archives/openg7-backup-20260925T020000Z.tar.gz \
  /archives/openg7-sponsor-logos-20260925T020000Z.tar.gz \
  recovery-private,recovery-public
```

Le dernier argument confirme exactement les deux buckets configurés. Le manifeste
adjacent à la configuration est obligatoire. La commande vérifie les empreintes,
les entrées d'archive et chaque objet avant toute écriture distante. Elle réserve
les cibles avec des écritures conditionnelles, refuse tout écrasement et relit
chaque objet restauré. Tous les objets reçoivent une ACL privée, y compris ceux
issus du bucket public. Les clés `system-recovery/restore-claim.json` puis
`restore-complete.json` conservent une preuve datée de début et de réussite.
Après un échec, considérer la cible comme incomplète et réservée : examiner les
deux buckets et leurs reçus avant de préparer une autre cible. L'écriture des deux
reçus n'est pas atomique. Aucune relance aveugle ni suppression.
Une sauvegarde ultérieure conserve les reçus de récupération précédents dans
l'archive. La restauration suivante crée ses propres reçus et compte les anciens
dans `archivedRecoveryRecords`, sans les rejouer sur les nouveaux reçus.

Cette commande restaure les **objets seuls**. Pour restaurer ensemble PostgreSQL
et S3, utiliser le flux commun ci-dessous. Revoir les URL publiques, les versions
et les autorisations avant toute réexposition. Une restauration ne constitue pas
une autorisation de publication.

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

### Variante PostgreSQL et S3

Installer les dépendances du checkout avec Yarn. Ajouter aux mêmes arguments :

```sh
  --s3-env /secure/recovery-s3.env \
  --confirm-s3-target recovery-private,recovery-public
```

Le fichier cible est obligatoire et lu comme des données, sans exécution shell ni
recours aux identifiants hérités de l'environnement. Il contient exclusivement
`SPONSOR_MEDIA_ENDPOINT`, `SPONSOR_MEDIA_REGION`, `SPONSOR_MEDIA_PRIVATE_BUCKET`,
`SPONSOR_MEDIA_PUBLIC_BUCKET`, `SPONSOR_MEDIA_PRIVATE_BASE_URL`,
`SPONSOR_MEDIA_PUBLIC_BASE_URL`, `OVH_S3_ACCESS_KEY_ID` et
`OVH_S3_SECRET_ACCESS_KEY`. Les deux dernières valeurs sont privées : fichier
`0600` hors Git, clés limitées aux buckets de récupération. Les URL doivent être
HTTPS, sans identifiants intégrés, paramètres, fragment ou slash final. Les valeurs
ne peuvent contenir ni apostrophe ni saut de ligne. `NODE_ENV=test` est admis
uniquement pour les fixtures HTTP sur `127.0.0.1`.

Les deux options sont indissociables; `--force` ne remplace pas la confirmation
des noms des buckets. Les trois empreintes d'archive et chaque objet sont vérifiés,
puis l'absence de données, d'ACL publiques/de groupe et de politique sur les deux
buckets. La configuration API effectivement résolue par Compose doit utiliser
exactement les paramètres S3 cibles. Ces valeurs remplacent les paramètres de
stockage dans le `.env` restauré; les autres secrets archivés restent à revoir
avant toute activation.

Après l'import PostgreSQL, les vérifications S3 sont répétées avant les réservations
conditionnelles et la copie des objets. Chaque objet est relu et comparé, avec ses
métadonnées. Les objets restent privés, y compris les anciennes copies publiques.
Les URL déjà enregistrées en base sont conservées : les rapprocher du futur domaine
et des buckets avant une remise en service. L'inspection locale des médias via
l'API ne vaut pas validation de ces URL ni autorisation de publication.

### Étapes communes et rapport

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
Les médias sont ensuite extraits vers le nouveau volume ou restaurés dans les
buckets S3 explicitement désignés. Aucun ancien volume
n'est supprimé. Si une étape échoue, API/Web restent arrêtés; conserver le diagnostic
et préparer une autre cible neuve. Nettoyer une cible ratée exige une opération
explicite limitée à ses ressources.

Le fichier privé `recovery-report.json` est créé après préflight et confirmation.
Il lie l'opération à un identifiant, au projet et aux empreintes des trois artéfacts,
puis enregistre les étapes DB/médias et, pour S3, le reçu de vérification. L'état
final `restored-stopped` signifie que les données sont restaurées et les services
applicatifs toujours arrêtés; `applicationChecks: pending` ne devient jamais une
qualification applicative par simple exécution du script. La recette navigateur
conserve séparément ses preuves.

Un échec laisse `state: failed` et la dernière étape atteinte. Une interruption
brutale peut laisser `in-progress`; la dernière étape peut avoir eu un résultat
incertain. PostgreSQL et S3 ne forment pas une transaction commune : si S3 échoue
après l'import, la base reste restaurée, les buckets restent réservés et aucun
service applicatif ne démarre. Réconcilier le rapport, PostgreSQL et les reçus S3
avant de choisir une autre cible. Le script refuse un checkout avec un rapport
existant, même sans `.env`, et ne supprime ni cible partielle ni rapport précédent.

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
docker pull adobe/s3mock:5.1.0
yarn exec playwright test --config tests/playwright-recovery.config.mjs
node --test tests/integration/s3-backup.integration.mjs
```

`yarn test:automation` regroupe ces recettes avec les alertes, les tests Node et
les parcours navigateur sur le build Angular de production. Prérequis : Node 22,
Yarn 4, dépendances installées, Docker local, les deux images ci-dessus et les
binaires Playwright Chromium/Firefox/WebKit. Les recettes sont aussi découvertes
par les suites déjà exécutées dans la CI Admin acceptance.

La recette construit une image API de la révision courante, sert le Web compilé,
crée des projets Docker à noms uniques et n'utilise ni `.env` du workspace, ni
base existante, ni fournisseur externe. Les seuls ports de test sont sur loopback;
le PostgreSQL du Compose de production reste privé. Les fixtures sont arrêtées
et supprimées après le test. Les preuves sont dans `test-results/recovery/`.

La recette S3 exécute le vrai `backup.sh` puis la restauration d'archive avec
S3Mock : pagination de 1 003 objets, empreintes/métadonnées, corruption, refus de la
source et d'une cible occupée, interruption et absence de reprise aveugle. Elle
teste le protocole des objets; les réponses d'inspection des politiques/ACL de
bucket sont simulées, car S3Mock ne les implémente pas. Les en-têtes ACL privées et
écritures conditionnelles sont contrôlés; IAM et accès anonymes OVH restent à qualifier.

La même recette applicative exerce les deux pilotes, `local` et `ovh-s3` : comparaison
de toutes les tables, contraintes et séquences, PDF facture/avoir identiques,
médias privés protégés, image publique affichée dans Chromium, transparence mobile
et files préservées. Le scénario S3 vérifie aussi les refus avant import et une
panne de stockage après l'import, le rapport incomplet, les buckets réservés et
l'absence de reprise aveugle. Seule la route Docker vers S3Mock est adaptée lors
du démarrage explicite de l'API de test; les buckets restaurés restent les mêmes.

Cette recette utilise une connexion admin par session signée en mode token.
Elle ne qualifie pas OIDC externe, DNS/HTTPS, délivrabilité,
objets/politiques OVH, rapprochement Stripe réel, ni restauration intégrale d'un VPS.
