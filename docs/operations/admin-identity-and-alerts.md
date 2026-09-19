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

Le navigateur découvre le mode avec `GET /api/admin/auth/config`. En OIDC :

- `GET /api/admin/auth/start` ouvre la connexion;
- `GET /api/admin/auth/callback` vérifie le retour du fournisseur;
- `GET /api/admin/auth/current` restaure l'identité de session;
- `POST /api/admin/auth/logout` révoque la session OpenG7;
- `GET /api/admin/access` liste les comptes et sessions;
- `POST /api/admin/access` modifie un compte ou révoque une session.

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
`021`. Les secrets restent côté serveur.
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

Prévoir une surveillance externe du site et du processus : une panne du VPS
ou du récepteur ne peut être annoncée par ce seul canal. Tester périodiquement
la réception d'une alerte synthétique sur l'environnement de test.
