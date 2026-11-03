# Connecteur OpenG7 Preflight

Le connecteur appartient à Funding et utilise l’API HTTP v1 de Preflight. Il
prépare et importe des propositions privées; l’approbation, les consentements,
la visibilité et la publication restent dans les services métier Funding.
Il est désactivé par défaut et aucune connexion de production n’est qualifiée.

## Parcours livré

L’activation vérifiée d’un engagement conserve une intention d’envoi dans la
même transaction PostgreSQL. Le relais indépendant envoie après commit une
mission sponsorship-preparation-v1 puis consulte ses résultats. Il valide leurs
schémas, source, révision, contrôles, empreinte et provenance avant de conserver
une préparation au statut proposed. Le dossier administratif affiche ces
préparations en lecture seule, avec simulation, obsolescence et limites explicites.
Importer ne modifie ni brouillon approuvé, ni reçu d’approbation, ni visibilité.

Le périmètre envoyé contient l’identifiant d’engagement, les prestations et le
matériel de préparation nécessaire. Les coordonnées privées et informations de
paiement ne sont pas exportées. Le nom public suit le consentement existant.

Le snapshot Funding possède une empreinte et une révision entière monotone
propres au connecteur. Les changements de sources déjà suivies sont détectés
par réconciliation du worker; ils invalident les préparations et notifient
source.updated avant ou avec la nouvelle mission. Une révision correspond à un
snapshot observé, pas à chaque événement intermédiaire entre deux passages.
L’import relit les faits courants sous verrou avant de valider leur empreinte.
Aucun backfill historique automatique n’est effectué.

## Préconditions et configuration

Appliquer la migration additive [064](../../apps/funding-api/migrations/064_create_preflight_connector.sql)
avec le runner habituel et rafraîchir les grants du rôle applicatif; lire la
[procédure](../operations/database-migrations.md) avant toute exécution. La garde
de démarrage refuse un connecteur activé sans base ou schéma/grants attendus.
La migration n’active aucun envoi et ne crée aucune mission historique.

Les variables sont définies dans [.env.example](../../.env.example) et validées
dans [config.ts](../../apps/funding-api/src/preflight/config.ts). PREFLIGHT_ENABLED,
URL, tenant, endpoints, clientId, scope, délais et budget sont des paramètres
backend non destinés au bundle Web. PREFLIGHT_CLIENT_SECRET et DATABASE_URL sont
privés. Les jetons restent en mémoire côté backend et ne sont jamais journalisés.
PREFLIGHT_ALLOW_INSECURE_LOCAL n’autorise HTTP que sur loopback, hors production.

Configurer un client OAuth2 confidentiel avec service account, rôle
service_integration, audience preflight-api, tenant_id et applications contenant
uniquement funding-platform. L’identité, les endpoints et les secrets réels
restent à provisionner et vérifier. Le client utilise client_credentials,
renouvelle son jeton avec cache et refuse les redirections HTTP.

Après configuration explicite et compilation, lancer le relais séparément :

```sh
yarn build
yarn preflight:worker
```

Le dossier et les endpoints administratifs réutilisent les sessions et droits
Funding existants. Ils exposent GET /api/admin/preflight/preparations avec
sponsorshipId UUID et GET /api/admin/preflight/status. Ces lectures ne permettent
aucune approbation; désactivé, le connecteur retourne une liste vide explicite.

## Livraison Docker préparée

L’overlay [docker-compose.preflight.yml](../../docker-compose.preflight.yml)
propage la configuration à l’API et ajoute un relais sans port entrant, Stripe,
SMTP, secrets admin ou credentials de migration. Après configuration et
validation de la cible, le profil preflight sélectionne ce relais. Le statut
disabled ne provoque pas d’appel réseau. Les redémarrages après échec sont bornés
à cinq; démarrage après reboot, surveillance et reprise après épuisement doivent
être organisés par l’exploitation du VPS.

Contrôle de composition sans lancement ni impression des secrets :

```sh
docker compose -f docker-compose.yml -f docker-compose.preflight.yml --profile preflight config --quiet
```

L’activation et le déploiement sur un VPS restent des opérations séparément
autorisées. Le relayage utilise HTTPS et le réseau privé Funding pour sa propre
base; aucune écriture directe n’est faite dans la base Preflight.

## Fiabilité et diagnostic

Les envois conservent un eventId et un missionId immuables. Un timeout est repris
avec les mêmes identifiants; le récepteur déduplique. Baux et jetons de tentative
empêchent deux workers de valider la même livraison locale. Les erreurs permanentes
et tentatives épuisées restent en quarantaine, sans effacer les messages.
Le heartbeat est observable avec yarn preflight:health; une réponse saine ne
qualifie ni l’identité distante, ni la facturation IA, ni une décision métier.

Le client expose aussi annulation versionnée et notification de décision source;
leur branchement aux actions métier et aux lots approuvés reste à définir.
La migration064 empêche de réécrire les payloads d’envoi et de préparation.
Les imports obsolètes restent inspectables et ne sont jamais approuvés automatiquement.

Les tests spécifiques sont tests/preflight-consumer.test.mjs,
tests/preflight-producer.test.mjs, tests/preflight-view.test.mjs et
tests/integration/preflight-connector.integration.mjs. Ils utilisent des fournisseurs
et données synthétiques. Une recette inter-dépôts peut en plus lancer le client
Funding contre l’API et le worker Preflight réels avec un issuer signé local;
elle ne qualifie pas un raccordement de production.

La recette inter-dépôts est conservée dans le dépôt Preflight :
[tests et preuves](https://github.com/OpenG7/openg7-preflight/pull/2).
Elle charge les modules Funding compilés uniquement dans son lanceur de test;
les applications déployées restent indépendantes et communiquent par HTTP.
