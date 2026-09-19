# Recette contrôlée des intégrations

Cette recette distingue l'accès aux fournisseurs du parcours complet d'un
contributeur. Elle utilise un environnement de test identifié, Stripe test, une
adresse courriel de test choisie et des contenus synthétiques. Elle ne déclenche
ni déploiement, migration, remboursement ni restauration de production.

## Contrôles déjà reproductibles sans mutation fournisseur

```sh
yarn providers:verify --env <configuration-de-test>
```

Le fichier est lu explicitement; les variables du shell ne le remplacent pas.
La commande compile l'API, puis vérifie Stripe test avec une lecture API, SMTP
par connexion/authentification et S3 par `HeadBucket`. Elle ne crée ni Checkout,
message ou objet. Un fournisseur absent ou en erreur rend la sortie non nulle.
Une clé live n'est jamais appelée. Conserver le rapport JSON et son horodatage,
sans ajouter la configuration au dépôt. La commande ne valide pas les politiques
d'accès anonyme, le versioning, les DNS de courriel ou la délivrabilité.

Le 19 septembre 2026, ces quatre contrôles ont réussi depuis la configuration
locale : Stripe test, SMTP, bucket privé, bucket public. Cela ne prouve pas la
configuration du VPS. `services:check` signale des paramètres HTTPS/administration
incomplets pour une mise en service; le fichier local n'a pas été modifié.

## Parcours avec les fournisseurs réels

Avant exécution, consigner l'URL de test, le commit et les images exécutées,
le mode Stripe test, l'adresse de réception, les buckets/prefixes de test et le
responsable de validation. Utiliser un espace de stockage de test distinct des
publications réelles et désactiver la publication sociale automatique réelle.
Ces paramètres sont requis : ne pas choisir silencieusement la production ou
l'adresse d'une personne existante.

1. Ouvrir le formulaire de commandite en FR puis vérifier sa navigation EN.
   Réaliser un Checkout avec une carte Stripe de test, sans réutiliser une carte
   réelle. Attendre la confirmation du webhook signé côté API.
2. Vérifier une seule contribution, une seule facture et les éléments attendus
   dans la file de courriels. Une redirection seule reste en attente.
3. Ouvrir le courriel reçu dans la boîte de test; vérifier le destinataire,
   les liens et la référence. Connexion SMTP réussie et état « envoyé » ne
   prouvent pas que le message est arrivé dans la boîte principale.
4. Demander un nouveau lien depuis `/support`, puis reprendre le dossier et
   enregistrer un brouillon. Refaire la demande avec une adresse inconnue :
   conserver la même réponse publique sans révéler l'existence d'un compte.
5. Ajouter un logo et une image synthétiques via le formulaire. Vérifier que
   les originaux sont privés. Approuver les médias et le dossier dans
   l'administration **de test**, après consentement, puis vérifier uniquement
   leurs copies publiques. Tester un remplacement et un retrait sur ce dossier.
6. Rejouer le même webhook signé de test sur l'environnement de test : aucun
   doublon de contribution, facture ou courriel logique. Consigner les preuves
   minimales sans jeton de suivi, courriel privé ni payload Stripe brut.

La recette attend encore une URL de test et une adresse destinataire confirmées.
Les droits d'écriture fournisseur ne se déduisent pas de la réussite des lectures.

## Sauvegarde et restauration jetables

```sh
yarn build
node --test tests/integration/backup-restore.integration.mjs
```

Ce test crée deux conteneurs PostgreSQL locaux distincts, en mémoire, sans lire
`.env`. Il applique les migrations à la source, charge des contributions
synthétiques, exécute `pg_dump`, restaure vers la seconde base vide et compare
les identifiants, les montants exacts et la projection publique. Restaurer une
seconde fois sur une base non vide est refusé. Les conteneurs sont supprimés
en fin de test. Cette épreuve a réussi le 19 septembre 2026.

Elle prouve la restauration du schéma et des données PostgreSQL. Elle ne prouve
pas une restauration de la configuration VPS, des objets S3, du volume de médias
ou du script de restauration de production. Leur exercice complet exige une
cible jetable explicitement identifiée et des archives de test; ne pas lancer
`restore-from-backup.sh` sur le workspace ou le VPS réel pour compléter ce test.

## Recette locale des fournisseurs et des médias

```sh
docker pull axllent/mailpit:v1.27.4
docker pull adobe/s3mock:5.1.0
docker pull postgres:16-alpine
yarn test:rehearsal
```

Cette recette a réussi le 19 septembre 2026. Elle ne charge aucun fichier
`.env`, publie uniquement sur loopback et crée des conteneurs à noms uniques.
Elle utilise les adaptateurs SMTP et S3 réels de l'application, avec des
serveurs locaux : un message MIME est reçu et relu dans Mailpit; les objets
privés sont copiés vers le stockage public puis sauvegardés avec une empreinte
SHA-256. Un fichier de configuration synthétique, le dump PostgreSQL et les
octets des médias sont relus et restaurés vers des cibles distinctes. Le retrait
d'une copie publique restaurée ne touche pas la source.

S3Mock prouve le protocole de stockage et la restauration des octets. Il ne
prouve pas les politiques IAM/ACL ou l'isolation publique du fournisseur OVH.
Mailpit prouve une réception SMTP locale, pas la délivrabilité dans une boîte
externe. Le snapshot du test n'est pas une archive générée par les scripts de
production : leur restauration complète sur un VPS jetable reste à exercer.

Références : [Mailpit Docker](https://mailpit.axllent.org/docs/install/docker/),
[S3Mock](https://github.com/adobe/S3Mock).

## Vérification humaine de l'accessibilité

Avec NVDA/Firefox ou VoiceOver/Safari, parcourir Fonds → Commanditaires → Suivi,
puis Aide et Bâtisseurs. Vérifier les titres, labels, ordre de tabulation,
annonces d'erreur, état de chargement et focus après pagination. Au zoom natif
200 % puis 400 %, les contrôles restent lisibles et atteignables. Consigner
l'outil, sa version, la révision et les observations. Ces vérifications humaines
restent à effectuer; les contrôles axe et de réagencement automatisés sont séparés.
