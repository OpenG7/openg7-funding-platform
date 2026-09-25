# Configurer les accès et les alertes

Ces fonctions restent désactivées par défaut. Aucun compte, webhook externe
ou environnement de production n'est créé par les tests.

## Comptes nominatifs

1. Préparer les migrations jusqu'à `020` sur un environnement de test selon
   la [procédure et sa limite de réexécution](database-migrations.md). En
   production, vérifier une sauvegarde avant toute migration autorisée.
2. Enregistrer un client confidentiel OIDC auprès du fournisseur choisi.
   Son callback exact est `https://<site>/api/admin/auth/callback`, sans wildcard.
3. Définir les variables de `.env.example` : `FUNDING_ADMIN_AUTH_MODE=oidc`,
   issuer, client ID, secret et subjects des premiers propriétaires.
   `FUNDING_PUBLIC_BASE_URL` doit désigner l'origine HTTPS commune Web/API.
4. Exiger le MFA chez le fournisseur. Vérifier qu'il retourne le claim signé
   `amr` contenant `mfa`, ou configurer `FUNDING_ADMIN_OIDC_MFA_ACR` uniquement
   avec les valeurs dont le fournisseur garantit la signification MFA.
5. Tester une connexion propriétaire et le refus d'une connexion sans MFA.
   Ouvrir **Accès et sessions** depuis la navigation admin pour ajouter les
   autres subjects et choisir leur rôle. Vérifier les refus API avec un lecteur.
6. Révoquer une session et confirmer son refus à la prochaine requête.

Modifier un compte ferme toutes ses sessions. Le dernier propriétaire actif
ne peut être rétrogradé ou désactivé. Le propriétaire doit confirmer les
changements et les révocations dans l'interface. La déconnexion termine la
session OpenG7; elle ne ferme pas la session globale chez le fournisseur.

Une panne OIDC refuse la connexion : aucun retour automatique au secret
racine. Revenir au mode `token` est un changement explicite de configuration,
qui retire les garanties nominatives. Les migrations additives peuvent rester.
Les paramètres OIDC passent par le `env_file` du service API existant.

La page est `/admin/fundraiser/access`. Elle exige le rôle propriétaire côté
API. Les sessions OIDC durent une heure sans renouvellement automatique;
`FUNDING_ADMIN_SESSION_TTL_MINUTES` concerne seulement le mode `token`.

| Rôle OIDC    | Autorisations                                                                                                                              |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Lecteur      | Lectures opérationnelles, recherche et requêtes de l'Assistant; aucune mutation                                                            |
| Opérateur    | Lectures et actions explicitement permises de revue, médias, publications, reprise/renvoi de courriels et préparation de brouillons        |
| Propriétaire | Toutes les opérations, dont dépenses, remboursements, backfill, CSV privé, configuration, renvoi d'accès commanditaire et comptes/sessions |

Les lectures de configuration, d'accès et de destinataire de renvoi commanditaire
sont également réservées au propriétaire. La liste exacte des mutations de
l'opérateur est dans `adminRoleAllows` (`apps/funding-api/src/admin-identity.ts`);
une nouvelle mutation est refusée par défaut. Les confirmations métier restent
obligatoires même avec le rôle approprié.

Le marqueur de présentation d’un [toast de contribution](contribution-activity.md)
est accessible aux trois rôles, uniquement pour l’acteur authentifié. Il ne
modifie aucun dossier ni autorisation de publication. Les comptes OIDC ont des
marqueurs distincts ; le mode token partagé conserve une identité commune.

Le navigateur découvre le mode avec `GET /api/admin/auth/config`. En OIDC :

- `GET /api/admin/auth/start` ouvre la connexion;
- `GET /api/admin/auth/callback` vérifie le retour du fournisseur;
- `GET /api/admin/auth/current` restaure l'identité de session;
- `POST /api/admin/auth/logout` révoque la session OpenG7;
- `GET /api/admin/access` liste les comptes et sessions;
- `POST /api/admin/access` modifie un compte ou révoque une session.

Cette mutation exige `confirmation` égal au `subject` du compte ou au `sessionId`
visé, après la décision explicite dans l'interface. Une confirmation absente ou
différente donne `400 CONFIRMATION_REQUIRED`; le retrait du dernier propriétaire
donne `409 LAST_OWNER`. Une session absente, expirée ou révoquée donne `401` sur
les lectures et mutations d'accès; un rôle insuffisant ou une origine refusée
donne `403`. Une indisponibilité de persistance ou d'audit donne
`503 ACCESS_UNAVAILABLE`, sans valider le changement. Révoquer à nouveau une
session ne répète pas son audit. L'opération
reste limitée aux comptes de l'issuer configuré.

API et Web doivent être mis à jour ensemble : les anciens clients sans
confirmation doivent actualiser la page. Aucune migration supplémentaire.
Après un refus `401` pendant une revue ou un changement d'accès, le formulaire
privé est fermé et la connexion explique que la session a expiré ou été révoquée.
Une révocation prend effet aux vérifications d'autorisation suivantes; elle
n'annule pas rétroactivement une opération déjà autorisée par le serveur.

## Recette des accès administrateurs

`yarn test:e2e:identity` compile l'API et le Web, puis lance Chromium avec une
base PostgreSQL 16 jetable et un fournisseur OIDC local signé. Prérequis : Node 22,
Yarn 4, Docker local, image `postgres:16-alpine` et Chromium installé. Aucune
configuration `.env`, base existante ou identité externe n'est utilisée.

La recette [navigateur](../../tests/identity/admin-identity.spec.ts) exerce :

- création de comptes opérateur et lecteur par le propriétaire, confirmation
  exacte et protection du dernier propriétaire;
- revue d'un dossier par l'opérateur, refus API des mutations du lecteur et
  des fonctions réservées au propriétaire;
- changement de rôle alors qu'une action confirmée attend encore dans le
  navigateur, révocation de toutes les sessions du compte, refus de l'action
  et reconnexion avec les nouveaux droits;
- annulation puis révocation d'une seule session, rejeu sans double audit,
  maintien de l'autre session, expiration serveur, désactivation/réactivation
  d'un compte et déconnexion;
- refus sans MFA, signature invalide, membre inconnu et panne d'échange OIDC,
  sans retour au jeton racine, puis connexion après rétablissement.

Les dossiers et métadonnées de médias sont préchargés et synthétiques; cette
recette ne qualifie ni le paiement ni le stockage des images. Les appels API et
les contrôles de signature, PKCE, nonce, origine et sessions sont réels. Le Web
compilé est servi localement avec un proxy vers l'API; cette recette ne qualifie
pas nginx, HTTPS, le fournisseur OIDC réel ni son dispositif MFA. Le HTTP est
limité à la boucle locale dans le mode de test déjà autorisé par l'API.

La CI exécute cette recette après les builds existants. Les traces d'échec et
le rapport sont sous `test-results/identity/`; la base et les processus possédés
par la recette sont arrêtés en fin d'exécution. Des tests UI séparés vérifient
FR/EN à 390 et 1280 px, la confirmation au clavier, le dernier propriétaire et
la fermeture du formulaire après expiration.

Validation locale du 24 septembre 2026 sur `fc2a9f6` avec les changements locaux :
2 parcours Chromium réussis en 25,5 secondes, 15 tests PostgreSQL ciblés
(identité et pilotage), 295 tests Node, 4 tests UI FR/EN et 4 contrôles
d'accessibilité sur plusieurs navigateurs réussis. Le premier démarrage WebKit bureau a
dépassé son délai de 30 secondes; le contrôle isolé est ensuite passé en
7 secondes. Builds API/Web/SSR, TypeScript et lint passent; restent l'avertissement
lint existant et le budget Angular initial dépassé (818,98 ko pour 800 ko).

Suivi du 25 septembre 2026 : la
[CI de la PR #171](https://github.com/OpenG7/openg7-funding-platform/actions/runs/36088163635)
échoue sur les quatre variantes du test UI des accès, avant les recettes OIDC
et de restauration. La trace montre une seconde confirmation sans clic effectif,
suivie d'une tentative de focus sur le bouton encore désactivé; aucune mutation
d'accès n'est envoyée. Le test attend désormais l'activation initiale, la remise
à zéro visible de la confirmation après modification du rôle, puis la nouvelle
activation et le focus avant Entrée. Il vérifie la réponse `409 LAST_OWNER`
et le retour à une confirmation non cochée après ce refus. Les délais et les
contrôles applicatifs restent inchangés; aucune relance automatique du test.

Sur `e832009` avec ce correctif local, les **192 tests UI admin** passent en
5,8 minutes, sans reprise, ainsi que le parcours de restauration sur API et
PostgreSQL jetables. Le build Angular/SSR (24 routes), TypeScript, lint et les
contrôles documentaires passent; l'avertissement ESLint préexistant subsiste.
La suite admin utilise des API interceptées : cette correction de synchronisation
ne remplace pas la recette OIDC réelle et ne constitue pas encore une réussite
de la CI GitHub, à confirmer après publication du correctif.

`yarn services:check` reste orienté vers les variables du mode token : il peut
signaler leur absence en OIDC et ne valide ni l'issuer, ni les assertions MFA,
ni le récepteur d'alertes. Utiliser la recette de connexion et de révocation
ci-dessus pour ces garanties.

## Proposition de canal d'alerte

Créer un canal privé **opérations** avec une intégration HTTPS indépendante du
courriel de la plateforme. Un récepteur ou relais traduit le contrat ci-dessous
dans le format du canal retenu. Ne pas renseigner un webhook Slack/Teams
directement sans adaptateur compatible avec ce contrat.

Configurer `FUNDING_OPERATIONS_WEBHOOK_URL`, un secret de signature d'au moins
32 caractères et `FUNDING_PUBLIC_BASE_URL`, avec PostgreSQL et la migration
`021`. Les secrets restent côté serveur. Le webhook et l'origine publique doivent
être des URL HTTPS sans identifiants intégrés; HTTP est admis uniquement sur
`localhost`, `127.0.0.1` ou `[::1]`, hors production. Le lien administratif utilise
l'origine publique, sans son chemin, sa requête ni son fragment. Une URL invalide
arrête le processus sans reprendre sa valeur dans l'erreur.
Le processus charge uniquement son environnement explicite :

```sh
# Après compilation, depuis un environnement de test explicitement configuré :
node --env-file=<configuration-de-test> scripts/operations-watch.mjs --once
```

Le premier lancement peut envoyer des alertes : utiliser un récepteur de test
avant le canal réel. Le mode continu interroge la base toutes les 30 secondes.
L'overlay `docker-compose.operations.yml` permet un processus distinct utilisant
l'image API construite. Aucun port supplémentaire n'est publié.
Le déploiement standard ne met pas ce service à jour automatiquement : inclure
l'overlay dans son exploitation et aligner son image sur la révision API choisie.

```sh
# Exemple d'activation, à exécuter uniquement sur l'environnement autorisé :
docker compose -f docker-compose.yml -f docker-compose.operations.yml up -d operations
```

Incidents couverts : courriel en échec, événement Stripe en échec ou bloqué
depuis 15 minutes, et lecture PostgreSQL indisponible. Les factures manquantes,
publications en retard et avertissements financiers restent dans la file admin.
Le processus n'envoie pas de notification de rétablissement; il ferme l'épisode
en base et permet une nouvelle alerte lors d'une récidive.
La lecture des incidents et leur synchronisation sont sérialisées : un surveillant
en attente du verrou relit les sources après l'avoir obtenu. Un incident résolu
avant une reprise ne déclenche plus de livraison. Une requête déjà partie peut
encore être reçue après le rétablissement; le dossier admin reflète l'état courant.

Le JSON contient `eventId`, `type`, `severity`, `firstSeen`, `adminUrl`.
Il ne contient aucun destinataire, nom, montant, texte de courriel, identifiant
Stripe ou erreur fournisseur. Vérifier la signature hexadécimale
`HMAC-SHA256(secret, timestamp + "." + corps_brut)` reçue dans
`X-OpenG7-Signature`, limiter l'âge de `X-OpenG7-Timestamp`, puis dédupliquer
`X-OpenG7-Event-Id`. Répondre en 2xx après acceptation durable.

Les échecs sont repris avec délai croissant, plafonné à une heure. Un bail
empêche deux workers de prendre simultanément la même alerte. Un arrêt après
réception mais avant acquittement DB peut provoquer une répétition du même ID.
Les lignes `operations_alerts` exposent les tentatives et échéances pour le
diagnostic; les logs de contrôle n'affichent aucun secret.
`status: "checked"` signifie que le cycle DB a réussi, et `delivered` compte les
acquittements de ce cycle. Un refus du récepteur reste en file même si `--once`
se termine avec le code 0 : ce résultat ne prouve pas la réception de toutes les
alertes. Vérifier aussi les alertes non résolues sans `delivered_at` et leur
`next_attempt_at`. Un échec DB termine `--once` avec le code 1.

Pendant une indisponibilité DB, l'identifiant de secours reste seulement en mémoire
du processus. Ses reprises conservent cet ID, mais un redémarrage pendant la panne
peut produire un nouvel ID; il ne bénéficie pas de la déduplication persistante
des incidents enregistrés dans `operations_alerts`.

Prévoir une surveillance externe du site et du processus : une panne du VPS
ou du récepteur ne peut être annoncée par ce seul canal. Tester périodiquement
la réception d'une alerte synthétique sur l'environnement de test.

### Recette isolée des alertes

```sh
yarn build
node --test tests/integration/operations-alerts.integration.mjs
node scripts/admin-acceptance.mjs tests/playwright/operations-alerts-acceptance.spec.ts
```

Les tests PostgreSQL utilisent des bases neuves jetables : concurrence sur le
verrou, bail actif puis expiré, échéance de reprise, plafond d'une heure, refus
des redirections et résolution avant nouvelle tentative. Le vrai script `--once`
est également exécuté avec une connexion refusée à sa DB de test; le récepteur
local vérifie la signature de l'alerte d'indisponibilité et la sortie non nulle.

La recette Chromium crée trois incidents synthétiques (courriel en échec, Stripe
en échec et Stripe bloqué). Un récepteur lié à la boucle locale du conteneur API
répond 503, accepte ensuite en perdant la réponse, puis acquitte les reprises.
Chaque cycle redémarre le vrai script; deux processus se disputent aussi la file.
Douze requêtes pour ces incidents produisent six notifications logiques : trois
épisodes initiaux, puis trois récidives après résolution. Le récepteur de test
conserve les IDs en mémoire; un adaptateur réel doit les stocker durablement.
Le navigateur suit le lien sans session, se connecte, consulte l'événement Stripe
puis le courriel en échec, en français sur ordinateur et en anglais à 390 px.
Le rapport des alertes est conservé dans `test-results/acceptance/`, avec les
traces navigateur en cas d'échec.
Ce test qualifie le contrat et la reprise locale, sans envoi vers un canal externe.
