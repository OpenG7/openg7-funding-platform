# Préparer le premier compte Keycloak au déploiement

Ce parcours optionnel prépare une personne du realm `openg7`, sur une base
identité neuve ou existante, puis transmet son User ID à l'API lors du lancement
applicatif. Il conserve les comptes existants, leurs mots de passe et leurs OTP.
Le choix du mot de passe définitif, les informations du profil demandées par
Keycloak, l'enrôlement OTP et la connexion restent personnels. Le compte
bootstrap du realm `master` reste distinct.

Utiliser le [profil local HTTPS](keycloak-local.md) ou le
[profil VPS](keycloak-vps.md) avant cette procédure. Le fournisseur doit être
Keycloak géré avec HTTPS, issuer exact, realm `openg7` et flow
`openg7-password-otp`. Ce parcours ne réconcilie ni le client OIDC ni un realm
déjà stocké, ne migre aucune base et ne qualifie pas une cible de production.
Les commandes réelles ci-dessous s'exécutent uniquement sur la cible autorisée.

## Configuration privée

Dans `.env` protégé ou l'environnement de déploiement, activer
`FUNDING_KEYCLOAK_PROVISION_USER=true` ; le défaut reste `false`.
`FUNDING_KEYCLOAK_ENABLED=true` est requis. Configurer ensemble
`FUNDING_KEYCLOAK_INITIAL_USER_USERNAME` et
`FUNDING_KEYCLOAK_INITIAL_USER_PASSWORD`. Le nom est normalisé en minuscules.
Choisir un mot de passe temporaire aléatoire d'au moins 14 caractères,
sans CR, LF ni NUL, distinct des secrets DB, bootstrap, OIDC et provisionnement.
Protéger ses caractères littéraux avec des valeurs compatibles avec Compose et
le lecteur shell de livraison, notamment les `$` ; ne pas committer `.env`.

Toutes les variables de provisionnement sont privées au déploiement :
commutateur, nom personnel, identifiant du client, mots de passe, secret et
subjects propriétaires. Aucun mot de passe initial, token administratif ou
secret de provisionnement n'est transmis à l'API ou au Web. L'API reçoit
seulement la configuration propriétaire nécessaire à ses contrôles serveur.

Pour le premier amorçage, le préparateur peut s'authentifier avec le compte
bootstrap `master` existant via `admin-cli`. Les variables
`FUNDING_KEYCLOAK_BOOTSTRAP_ADMIN_USERNAME` et
`FUNDING_KEYCLOAK_BOOTSTRAP_ADMIN_PASSWORD` doivent correspondre à ce compte
réel : les modifier ne renomme ni ne réinitialise un compte déjà créé.
Un administrateur dont l'authentification exige OTP ne remplace pas directement
ce parcours non interactif.

Après retrait du bootstrap, préparer un client de service confidentiel dédié
dans `openg7`, avec comptes de service activés et uniquement les droits
`query-users`, `manage-users` et `view-realm` du client `realm-management`.
Le droit `view-realm` permet de lire l'identifiant du realm et le profil attendu.
Renseigner ensemble `FUNDING_KEYCLOAK_PROVISION_CLIENT_ID` et
`FUNDING_KEYCLOAK_PROVISION_CLIENT_SECRET` ; le secret doit comporter au moins
32 caractères, être distinct de tous les autres secrets et rester protégé sur
l'hôte de déploiement. Ce client est préparé séparément, pas créé par le script.
Conserver une administration nominative avec MFA pour son entretien et limiter
l'accès à ces credentials de création de comptes.

La configuration typée fait foi :
[keycloak-config.mjs](../../scripts/lib/keycloak-config.mjs). Examiner le plan :

```sh
yarn keycloak:provision-user --dry-run
```

Cette commande valide les variables sans requête au fournisseur, écriture
privée ni changement de compte. La lecture de `.env` demande Docker Compose,
sans contacter le daemon. Elle ne prouve pas les droits du compte administratif,
le secret client, DNS, TLS, OTP ou une connexion OpenG7.

## Création, compte existant et propriétaire

Le préparateur cherche le nom exact. S'il est absent, il crée un seul utilisateur
activé avec mot de passe temporaire et actions `UPDATE_PASSWORD` et
`CONFIGURE_TOTP`. Il conserve l'UUID attribué par Keycloak et vérifie ensuite ce
compte par son UUID. Il ne crée aucun rôle OpenG7 directement dans Keycloak.

Un compte déjà présent doit correspondre à un UUID de l'état privé ou à un
User ID vérifié déjà défini dans `FUNDING_ADMIN_OIDC_OWNER_SUBJECTS`. Le nom
d'utilisateur seul ne permet jamais d'accorder le rôle propriétaire. Sans cette
preuve, le préparateur s'arrête ; relever une fois l'UUID dans la fiche de la
personne du realm `openg7` et le vérifier dans la configuration privée.
Un compte désactivé, fédéré ou de service n'est pas adopté comme personne.

Si la liste propriétaire est vide, les lanceurs transmettent le subject vérifié
à l'API pour cette invocation. Une liste explicite est conservée intégralement,
sans ajout du nouvel utilisateur. `.env` n'est pas réécrit. La création du
propriétaire OpenG7 attend sa première connexion MFA réussie selon le
[contrat d'accès](admin-identity-and-alerts.md#comptes-nominatifs).

La commande autonome :

```sh
yarn keycloak:provision-user
```

prépare ou vérifie le compte et sauvegarde son User ID, mais ne démarre pas
l'API et ne modifie pas son environnement chargé. Les lanceurs `docker:up`,
`docker:update`, `docker:recreate` et `scripts/deploy.sh` reprennent cette étape
avant de démarrer l'application et transmettent les subjects à Compose.
`--subjects-only` est une sortie privée réservée à la capture par la livraison ;
ne pas l'imprimer dans un terminal partagé ou un journal.

Lorsque le provisionnement est activé, le rollback applicatif restaure aussi
le subject depuis cet état privé vérifié si la liste de `.env` est vide. Il
conserve une liste explicite. Sa capture interne `--restore-subjects-only` lit
uniquement la configuration et l'état correspondant à l'issuer et au nom :
aucune requête au fournisseur, création de compte ou écriture d'état/journal.
Un état absent, invalide ou non vérifié bloque le rollback avant le changement
des conteneurs. Cette lecture conserve la possibilité de la première connexion
OpenG7 ; elle ne vérifie pas l'état courant du fournisseur ou l'enrôlement OTP.

## Parcours local

Avec les variables du [profil local](keycloak-local.md) et le commutateur activé :

```powershell
yarn keycloak:provision-user --dry-run
yarn docker:up:dev:keycloak
```

Le lanceur prépare HTTPS, démarre l'identité et Traefik, prépare le compte puis
démarre la pile applicative. Le compte peut être créé sur la base existante sans
supprimer son volume. Sur un fournisseur déjà sain, la commande autonome permet
aussi de préparer le compte avant `yarn docker:recreate`.

Ouvrir `https://auth.openg7.test/realms/openg7/account/`, changer le mot de passe
temporaire puis configurer son authentificateur OTP. Compléter le profil si
Keycloak le demande ; aucun nom, prénom ou email privé n'est inventé par le
provisionnement. Effectuer ensuite une
nouvelle connexion complète mot de passe + OTP depuis
`https://localhost/admin/login`. L'enrôlement seul ne prouve pas le MFA du token
courant et peut produire un premier callback refusé par OpenG7.

## Parcours de production

Après préflight, autorisation et préparation DNS/HTTPS du
[guide VPS](keycloak-vps.md), démarrer d'abord uniquement l'identité :

```sh
yarn keycloak:provision-user --dry-run
yarn docker:up:prod:keycloak --identity-only
```

Ce lancement prépare le compte et sauvegarde son UUID, sans API, Web, worker ou
DB Funding. Pour un fournisseur déjà préparé, `yarn keycloak:provision-user`
remplit la même fonction sans démarrage de services.

La personne ouvre la console de compte du realm `openg7` sur l'origine HTTPS
configurée, change son mot de passe et configure OTP. Vérifier ensuite une
nouvelle authentification avec les deux facteurs. La livraison applicative
exige un credential OTP présent et l'absence des actions `UPDATE_PASSWORD` et
`CONFIGURE_TOTP` pour la personne préparée ; sinon elle s'arrête avant le
démarrage de l'API. Cette condition prouve l'enrôlement, pas l'exécution MFA d'un
token ni la qualification complète du fournisseur.

Continuer alors le [premier démarrage applicatif](keycloak-vps.md#premier-demarrage-oidc),
avec les migrations et contrôles autorisés. La livraison Bash, la mise à jour
et la recréation exigent une identité déjà disponible et préservent son cycle
de vie séparé. Tester la connexion propriétaire, le refus sans MFA et la
révocation de session. Une santé HTTPS ou la présence de l'OTP ne remplace pas
cette recette. Le provisionnement ne retire pas automatiquement le bootstrap.

## État privé, répétition et reprise

Le répertoire ignoré par Git
`var/keycloak-provisioning/<hash-issuer-et-username>/` contient `user.json`,
le verrou d'exécution et `audit.jsonl`. L'état version 1 lie issuer exact,
identifiant du realm, nom, phase et UUID confirmé. Les phases sont `pending`,
`rejected` et `verified` ; un refus confirmé ne possède aucun UUID. Le realm ID protège contre la
réutilisation silencieuse après remplacement du realm ; cette liaison HTTPS
reste utilisable entre réplicas du même fournisseur. Les répertoires et fichiers
sont vérifiés avec permissions privées `0700`/`0600` sous POSIX et les symlinks
sont refusés. Sous Windows, protéger aussi le dossier par ses ACL.
Le journal consigne acteur, action, cible, date, résultat et corrélation sans
mot de passe ni token.

Conserver cet état et la configuration tant que la liste propriétaire explicite
reste vide. Les exécutions suivantes vérifient l'UUID et les droits nécessaires,
sans changement de mot de passe, d'OTP ou de session. Modifier le mot de passe
initial dans `.env` ne change jamais le credential d'un compte existant.

Une tentative est enregistrée avant l'unique POST de création. Un UUID reçu
avec HTTP 201 est sauvegardé avant la vérification suivante ; une interruption
après cet accusé permet de reprendre uniquement la lecture et la vérification.
Un HTTP `403` reçu pour le POST confirme un refus avant création. Le préparateur
enregistre la phase `rejected` et le résultat `creation-rejected` dans l'audit.
Après correction du droit `manage-users`, une nouvelle invocation vérifie le
realm et l'absence du nom exact, puis peut tenter la création. Elle enregistre
à nouveau `pending` avant le POST. Si un compte est apparu entre-temps, son nom
seul ne permet toujours pas de l'adopter comme propriétaire.
Si la réponse est perdue, le résultat ambigu ou le conflit non lié à un UUID
vérifié, aucune création ou réinitialisation n'est répétée automatiquement.
Les autres statuts, y compris `400`, `429` et les erreurs serveur, conservent
ce traitement prudent. Un ancien état `pending` ne prouve pas un refus `403`.
Examiner le journal, le compte du realm et son User ID avant de renseigner le
subject vérifié et de relancer. Un verrou abandonné exige la vérification de
l'opération et de l'absence de processus actif avant son retrait explicite.
Conserver un état incohérent pour réconciliation, sans effacer la DB identité.

Lors d'une bascule depuis l'import local antérieur, garder l'ancien état sous
`var/keycloak-local/` et vérifier une fois l'UUID propriétaire existant. Avec le
nouveau commutateur, l'import utilisateur initial est désactivé au profit du
provisionnement après disponibilité HTTPS ; aucun ancien UUID n'est adopté
implicitement. L'import canonique du realm reste conservé.

Les contrôles ciblés de configuration, créations/répétitions simulées, UUID,
état/audit privés, reprise incertaine et propagation aux lanceurs se lancent par :

```sh
node --test tests/keycloak-provision-user.test.mjs tests/keycloak-provision-launchers.test.mjs
```

La [recette HTTPS jetable](../../tests/identity/keycloak-local-https.integration.mjs)
couvre aussi le provisionnement réel, la répétition après changement du mot de
passe et enrôlement OTP, puis la connexion et la révocation OpenG7. Ses prérequis
sont dans la [matrice de validation](../development/validation.md).
La présence de ces contrôles ne prouve ni leur exécution sur cette révision ni
une qualification de production.
