# Recette contrôlée des intégrations

Cette recette distingue l'accès aux fournisseurs du parcours complet d'un
contributeur. Elle utilise un environnement de test identifié, Stripe test, une
adresse courriel de test choisie et des contenus synthétiques. Elle ne déclenche
ni déploiement, migration, remboursement ni restauration de production.

## Contrôles déjà reproductibles sans mutation fournisseur

Commencer par le diagnostic local de la configuration explicite :

```sh
node scripts/services-check.mjs --env <configuration-de-test> --env-only
```

Il contrôle notamment le mode d'administration token/OIDC et la configuration
du canal d'alertes, sans appeler les fournisseurs. Consulter les avertissements
et les [limites du diagnostic](admin-identity-and-alerts.md#diagnostic-de-configuration-avant-recette)
avant de passer aux contrôles d'accès : un résultat positif ne qualifie ni le
MFA ni la réception d'une alerte.

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

Les publications DNS peuvent être examinées séparément avec
`yarn email:dns --domain <domaine-from> --selector <selecteur-dkim>`.
Confirmer aussi les domaines d'enveloppe et de signature auprès du fournisseur;
les [options et limites](../email-smtp.md#read-only-dns-diagnostic) précisent les
contrôles, les codes de sortie et les éléments restant à rapprocher. Cette lecture
ne constitue ni un envoi ni une preuve de réception.

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

### Fiche de préparation de la recette réelle

Préparation du 25 septembre 2026 : aucun parcours fournisseur réel exécuté.
Compléter cette fiche dans le compte rendu privé de l'environnement de test,
sans ajouter d'adresse personnelle, de configuration ou de secret dans Git.

Noms proposés : `https://recette.openg7.org` et
`recette-financement@openg7.org`. Leur disponibilité, leur création et leur
configuration restent à confirmer; ce ne sont pas des cibles déjà validées.

| Élément      | Valeur à consigner avant exécution                                                                                                                           |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Cible        | URL HTTPS de test et confirmation qu'elle ne dessert pas la production                                                                                       |
| Révision     | Commit, images Web/API et état des migrations de cette cible                                                                                                 |
| Validation   | Responsable, date et adresse de réception dédiée confirmée                                                                                                   |
| Paiement     | Compte Stripe de test et réception du webhook signé sur cette cible                                                                                          |
| Stockage     | Buckets privé/public et préfixe réservés à la recette, droits vérifiés                                                                                       |
| Publications | Publication sociale réelle désactivée; revue et visibilité limitées au dossier synthétique de test                                                           |
| Limites      | Un dossier, un Checkout de test et un rejeu du même webhook; aucune relance sur résultat incertain                                                           |
| Preuves      | Rapport fournisseur horodaté, références synthétiques, compteurs avant/après, réception du courriel, contrôle privé/public des médias et audit des décisions |

Après chaque étape numérotée, consigner le résultat attendu, le résultat observé
et la référence de preuve. En cas d'écart, arrêter la séquence et réconcilier
l'état Stripe, API, courriel ou stockage avant une reprise. La préparation de
cette fiche ne vaut pas validation de l'environnement ni autorisation d'envoi.

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

Elle prouve la restauration du schéma et des données PostgreSQL. La
[recette de récupération applicative](backup-recovery.md#recette-locale-automatisee)
exerce aussi les vrais scripts, les archives de configuration/médias locaux,
l'API et le Web sur des cibles jetables. Ne pas lancer `restore-from-backup.sh`
sur le workspace ou le VPS réel pour compléter un test.

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
production. La [recette des scripts](backup-recovery.md) est distincte et couvre
le stockage local; une restauration complète du VPS et des objets OVH reste
une opération séparée.

Références : [Mailpit Docker](https://mailpit.axllent.org/docs/install/docker/),
[S3Mock](https://github.com/adobe/S3Mock).

## Connexions sociales locales

La [recette locale de récupération des connexions sociales](publication-automation.md#local-connection-recovery-recipe)
couvre séparément Facebook/LinkedIn simulés, OIDC, blocages et nouvelle
approbation avant reprise. Elle ne qualifie pas les comptes sociaux réels.

## Vérification humaine de l'accessibilité

Avec NVDA/Firefox ou VoiceOver/Safari, parcourir Fonds → Commanditaires → Suivi,
puis Aide et Bâtisseurs. Vérifier les titres, labels, ordre de tabulation,
annonces d'erreur, état de chargement et focus après pagination. Au zoom natif
200 % puis 400 %, les contrôles restent lisibles et atteignables. Consigner
l'outil, sa version, la révision et les observations. Ces vérifications humaines
restent à effectuer; les contrôles axe et de réagencement automatisés sont séparés.
