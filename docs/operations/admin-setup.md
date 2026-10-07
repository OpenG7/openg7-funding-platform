# Configuration et état du système

La page `/admin/fundraiser/setup` rassemble la configuration administrative,
les observations des services et les accès au diagnostic. En OIDC, sa lecture
reste réservée au propriétaire. Le tableau de bord conserve les indicateurs
financiers; `/admin/fundraiser/pilotage` conserve les décisions métier.

## Parcours

<a id="guidage-oidc"></a>

### Identité et premier accès OIDC

Avant la première connexion, `/admin/oidc-setup` présente un parcours statique :
fournisseur et client confidentiel, HTTPS/callback, MFA, personnes et subjects,
DB Funding/migrations/rôle restreint, configuration serveur puis livraison et
connexion. Cette page fonctionne sans session ni appel API ; elle ne lit aucune
configuration runtime et ne collecte aucun secret. Elle ne démarre pas de service
et ne modifie ni `.env` ni le fournisseur. Les opérations réelles suivent le
[premier démarrage Keycloak](keycloak-vps.md#premier-demarrage-oidc) ou le
[runbook des accès](admin-identity-and-alerts.md) pour un fournisseur externe.

Après connexion propriétaire, `/admin/fundraiser/setup?section=identity` ouvre
le diagnostic et son guide pas à pas. Les informations viennent du bloc optionnel
`identity` de `GET /api/admin/setup-status` :

- `mode` : `oidc` ou `token` ; `issuer` et `callback_url` : URL publique sûre ou `null`.
- `client_id_configured`, `client_secret_configured`, `owner_bootstrap_configured`,
  `private_data_encryption_configured` : présence/configuration seulement, sans valeurs.
- `mfa_policy` : claim `amr` ou politique `acr` prévue côté API, sans claim ni token.

Une ancienne API peut omettre `identity` : le diagnostic reste inconnu et les
autres panneaux continuent de fonctionner. Le mode token est identifié comme
local/test. Une configuration OIDC complète n'atteste ni discovery/JWKS, ni
validité du secret client, ni connexion au fournisseur, ni MFA réellement effectué.
Le guide explique les vérifications manuelles et renvoie aux procédures propriétaires ;
parcourir une étape n'en valide pas l'exécution.

Le guide et le tableau des paramètres partagent leur
[catalogue de variables](../../apps/funding-web/src/app/features/funding/components/admin-identity-setup/identity-setup-fields.ts).
Les [projections du guide](../../apps/funding-web/src/app/features/funding/components/admin-identity-setup/identity-setup-projections.ts)
calculent les observations ; le composant conserve la navigation et le focus,
avec un seul template pour les instructions actives et la lecture complète.
Le [module identité API](../../apps/funding-api/src/admin-identity.ts) construit
les diagnostics OIDC et token ; l’agrégateur setup reçoit ce snapshot.

`owner_bootstrap_configured=false` ne bloque pas le bilan de configuration : un
propriétaire peut déjà exister en base. Sur une base neuve, les premiers subjects
restent à préparer selon le runbook des accès. Aucun subject, credential, cookie,
claim ou token n'est exposé. Le diagnostic est une lecture réservée au propriétaire,
avec refus `401` sans session et `403` pour lecteur/opérateur ; aucun changement de
droits, de MFA ou de secrets n'est proposé par cette page.

### Observations des services

Les cartes Stripe, courriel, stockage et PostgreSQL utilisent
`GET /api/admin/cockpit/systems`. Elles affichent la source, la date et la portée
du contrôle. Une observation périmée ou une actualisation échouée retire le
statut opérationnel, y compris pendant une nouvelle tentative : seule une
réponse réussie valide à nouveau les observations. La présence de paramètres
ne prouve pas une connexion.
Les contrôles de lecture ne prouvent ni l'écriture du stockage ni la réception
du courriel. Une absence d'activité récente ne prouve pas une panne.

Stripe présente deux observations indépendantes : **Connexion à Stripe** et
**Activité des webhooks**. La connexion est vérifiée par une lecture authentifiée
du compte (`GET /v1/account`), limitée à deux secondes sans retry, puis conservée
au plus une minute. Elle exige la clé API; le contrôle des webhooks exige aussi
leur secret. Aucun paiement, envoi, changement de compte ni donnée de compte
privée n'est produit par ce contrôle.

Un webhook de paiement traité depuis moins de quinze minutes confirme une
activité récente. Sinon, la carte affiche « Aucune activité récente » et la date
du dernier webhook traité, si connue. Les échecs ou traitements bloqués restent
signalés séparément, même si la connexion est opérationnelle. Une erreur de
lecture de ces observations empêche un bilan favorable. Les anciennes réponses
sans contrôle de connexion sont affichées comme non vérifiées pour la connexion.

Contrat : les champs existants `state`, `evidence`, `checkedAt`, `observedAt` et
`validUntil` de Stripe conservent leur sens d'observation des webhooks. L'objet
additionnel `connection` reprend ces cinq champs pour la connexion : succès
`operational` / `stripe_api_read`, échec ou timeout `unavailable` / `check_failed`,
clé absente `not_configured`. Les détails du compte et les erreurs du fournisseur
ne sont jamais exposés. L'absence du champ, avec une ancienne API, ne prouve
aucune connexion. Les requêtes simultanées partagent le même contrôle en cours.

La recommandation priorise la connexion DB, la lecture de la file, les messages
en échec et les problèmes observés, puis les conseils d’identité et les autres
paramètres incomplets, avant les observations manquantes. Son bouton ouvre un
diagnostic ou la file courriel; il ne lance aucune opération externe. Le bilan
favorable exige les quatre contrôles de service valides et les points de
configuration vérifiés. Pour Stripe,
une absence d'activité seule n'invalide pas une connexion confirmée; les erreurs
de webhooks et les observations indisponibles ou périmées restent à examiner.

La checklist utilise `GET /api/admin/setup-status` et distingue ses paramètres
des observations. Elle ne certifie pas un déploiement. Si la lecture de la file
échoue, les compteurs sont indéterminés et le test courriel est indisponible,
y compris avec un ancien serveur renvoyant des zéros et une erreur de lecture.

Les paramètres de facturation affichés proviennent du même snapshot de démarrage
que l'émission des factures et avoirs, défini dans
[la configuration propriétaire](../../apps/funding-api/src/sponsorship-invoice-config.ts).
Une modification d'environnement exige un redémarrage de l'API; les documents
déjà émis conservent leurs snapshots.

Les paramètres détaillés se déplient dans chaque panneau. Les cartes et les
liens `?section=identity`, `?section=storage` ou `?section=database` ouvrent et focalisent le panneau
correspondant. Le guide utilise le panneau accessible commun : Tab, fermeture
par Échap et retour du focus. Toutes ces consultations restent sans mutation.

L'activité est celle du financement et des dossiers, pas un journal Docker.
Le lien d'audit ouvre le journal administratif existant. L'heure de vérification
est affichée en America/Toronto, en français ou en anglais.

Le test courriel conserve son [contrat d'envoi et de reprise](../email-smtp.md#admin-configuration-test) :
requête identifiée, statut serveur, résultat incertain consultable sans nouvel
envoi. Le test est une action explicite, jamais une conséquence de l'actualisation.

La section pleine largeur [Sauvegardes et récupération](admin-database-backups.md),
accessible depuis la navigation, rassemble synthèse, activation guidée, demandes
de capture et historique compact avec détails latéraux. Son worker indépendant reste
à configurer : politique quotidienne UTC, chiffrement et protection hors serveur
pendant au moins 30 jours. L'actualisation ne crée aucune demande. La restauration
et les ensembles complets DB/médias/configuration restent des opérations distinctes.

## Découpage de l'intégration de la maquette

| Sous-tâche                   | Périmètre                                                                              | État                             |
| ---------------------------- | -------------------------------------------------------------------------------------- | -------------------------------- |
| 1. Composition               | Séparer TypeScript, HTML et CSS; conserver la navigation admin                         | Implémentée                      |
| 2. États des services        | Réutiliser les observations du cockpit, leurs erreurs et leur expiration               | Implémentée                      |
| 3. Présentation              | Cartes, recommandation centrale, panneaux, checklist et activité responsive            | Implémentée                      |
| 4. Diagnostic                | Recommandation déterministe, paramètres détaillés, guide et parcours courriel conservé | Implémentée                      |
| 5. Intégration               | Liens directs, droits existants, traductions FR/EN et retour après connexion           | Implémentée                      |
| 6. Validation                | Build/SSR, lint, tests UI, clavier, accessibilité et captures mobile/desktop           | Vérifiée avec limites ci-dessous |
| 7. Télémétrie complémentaire | Version livrée, observations Web/API et TLS; sauvegardes décrites ci-dessus            | Hors sauvegardes : à réaliser    |
| 8. Exécution administrative  | Parcours séparés de diagnostic avancé et d'opérations autorisées                       | À concevoir                      |

Le lot 7 nécessite des sources serveur horodatées : révision effectivement
livrée et résultats CI associés, vérification de santé avec sa cible, certificat
et date d'expiration, sauvegarde avec périmètre et preuve. Aucune disponibilité
historique ni mention « prêt à déployer » n'est déduite des quatre cartes.

Le lot 8 exige un catalogue fermé, des droits serveur distincts, cible et
préconditions explicites, confirmations, audit, idempotence et reprise après
résultat incertain. Les scripts et ProductionLaunchAgent existants ne sont pas
des endpoints Web. L'intégration visuelle n'ajoute pas d'accès SSH, de console
SQL, de commande Docker ni de changement d'environnement.

## Vérification ciblée

Après le build Angular production, exécuter le contrôle TypeScript admin et les
tests `admin-identity-setup-ui.spec.ts`, `admin-setup-layout.spec.ts`, `admin-setup-email-ui.spec.ts` et
`admin-cockpit.spec.ts` avec `tests/playwright-admin-ui.config.mjs`.
Ils utilisent des API interceptées et des données synthétiques, sans `.env`,
envoi SMTP ni fournisseur réel. Les captures sont dans `test-results/admin-layout/`.
La recette SMTP/OIDC réelle reste celle du guide courriel; ces tests UI ne la
remplacent pas.

Le 6 octobre 2026, sous Node 22.23.3, le guidage OIDC et les régressions setup/
courriel ont été vérifiés sur le build production : 33 scénarios UI réussis,
dont neuf pour le guide, avec FR/EN, mobile, axe, clavier et lecture sans
JavaScript. L'API indisponible laisse le guide public consultable lorsque le Web
est servi ; aucune requête API ni mutation n'est émise par ce guide. Les réponses
anciennes, les paramètres manquants, le mode token et les erreurs/refus de lecture
restent non confirmés. Les tests Node des diagnostics et projections réussissent,
y compris la protection des URL issuer avec paramètres privés. Le build produit
25 routes prérendues ; Nginx est vérifié sur un conteneur local jetable, avec et
sans slash final, et conserve les 404 des routes inconnues. TypeScript, format,
standards et budgets passent ; lint sans erreur, avec l'avertissement existant
de `scripts/smoke-public.mjs`. Aucun fournisseur réel ni VPS n'a été qualifié.

Après correction des P2/P3 le même jour, les 20 tests de projections et les
25 scénarios UI du guidage et de la configuration réussissent, dont onze pour
le guide. Les incidents précèdent les conseils d’identité en mode token, avec
une ancienne API et en OIDC incomplet. Les deux scénarios FR/EN suivent le chemin
prescrit `/admin/fundraiser` jusqu’à la connexion OIDC, avec API simulée.

Après consolidation à comportement constant le même jour, `yarn test` compte
5 551 réussites, un test ignoré et aucun échec. Les 57 scénarios navigateur du
guide, de la configuration et de la récupération courriel réussissent avec API
interceptée. Une comparaison avant/après conserve les lignes du tableau et les
libellés d’identité sur 12 cas synthétiques. Build Angular/TypeScript, format,
documentation et diff passent ; l’avertissement lint préexistant reste présent.

Vérification locale du 30 septembre 2026, avec Node 22.23.3 et Yarn 4.9.4 :
build Angular production et 24 routes prérendues, compilations TypeScript
applicative et admin, lint et format ciblé réussis. Les 11 scénarios UI de setup,
les deux scénarios du test courriel et les 15 scénarios du cockpit réussissent
sur le build final. Les quatre variantes FR/EN à 390 et 1600 px comprennent
axe, focus, guide et table dépliée, avec défilement horizontal au clavier sur
mobile. Les observations périmées, erreurs partielles, liens directs, session
expirée et refus d'accès sont exercés sans mutation externe. Deux régressions
vérifient que les observations restent inconnues pendant une nouvelle tentative
après erreur, dans setup et dans le cockpit, jusqu'à la réponse réussie.

Les deux tests de `tests/identity/setup-email-journey.spec.ts` réussissent aussi
avec l'API réelle, PostgreSQL jetable, le fournisseur OIDC signé local et Mailpit.
Le scénario mobile déplie désormais les variables au clavier avant de focaliser
et faire défiler la table. Cette recette vérifie également les droits, l'envoi
unique, la reprise après perte de réponse et l'expiration de session; elle ne
qualifie pas un fournisseur SMTP ou OIDC de production.

Les trois suites Node ciblées comptent 91 réussites sur 92. L'échec préexistant
de `funding-admin-backoffice-coverage.test.mjs` attend encore
`close = output<void>()` dans le composant d'en-tête commanditaire, qui ne possède
plus cette sortie. Ce composant n'est pas modifié ici. Le lint conserve également
l'avertissement préexistant de `scripts/smoke-public.mjs`.

Le contrôle des standards réussit. Le contrôle des budgets documentaires signale
`docs/command-cheatsheet.md`, inchangé : 14 532 octets dans le checkout Windows
contre 14 334 dans Git, pour une limite de 14 336. L'écart provient des fins de
ligne CRLF. Le diff est vérifié sans erreur d'espacement. Aucun résultat de CI,
fournisseur réel ou déploiement n'est déduit de cette recette locale.
