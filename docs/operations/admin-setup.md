# Configuration et état du système

La page `/admin/fundraiser/setup` rassemble la configuration administrative,
les observations des services et les accès au diagnostic. En OIDC, sa lecture
reste réservée au propriétaire. Le tableau de bord conserve les indicateurs
financiers; `/admin/fundraiser/pilotage` conserve les décisions métier.

## Parcours

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
en échec et les problèmes observés, puis la configuration incomplète et les
observations manquantes. Son bouton ouvre un diagnostic ou la file courriel;
il ne lance aucune opération externe. Le bilan favorable exige les quatre
contrôles de service valides et les points de configuration vérifiés. Pour Stripe,
une absence d'activité seule n'invalide pas une connexion confirmée; les erreurs
de webhooks et les observations indisponibles ou périmées restent à examiner.

La checklist utilise `GET /api/admin/setup-status` et distingue ses paramètres
des observations. Elle ne certifie pas un déploiement. Si la lecture de la file
échoue, les compteurs sont indéterminés et le test courriel est indisponible,
y compris avec un ancien serveur renvoyant des zéros et une erreur de lecture.

Les paramètres détaillés se déplient dans chaque panneau. Les cartes et les
liens `?section=storage` ou `?section=database` ouvrent et focalisent le panneau
correspondant. Le guide utilise le panneau accessible commun : Tab, fermeture
par Échap et retour du focus. Toutes ces consultations restent sans mutation.

L'activité est celle du financement et des dossiers, pas un journal Docker.
Le lien d'audit ouvre le journal administratif existant. L'heure de vérification
est affichée en America/Toronto, en français ou en anglais.

Le test courriel conserve son [contrat d'envoi et de reprise](../email-smtp.md#admin-configuration-test) :
requête identifiée, statut serveur, résultat incertain consultable sans nouvel
envoi. Le test est une action explicite, jamais une conséquence de l'actualisation.

## Découpage de l'intégration de la maquette

| Sous-tâche                   | Périmètre                                                                              | État                             |
| ---------------------------- | -------------------------------------------------------------------------------------- | -------------------------------- |
| 1. Composition               | Séparer TypeScript, HTML et CSS; conserver la navigation admin                         | Implémentée                      |
| 2. États des services        | Réutiliser les observations du cockpit, leurs erreurs et leur expiration               | Implémentée                      |
| 3. Présentation              | Cartes, recommandation centrale, panneaux, checklist et activité responsive            | Implémentée                      |
| 4. Diagnostic                | Recommandation déterministe, paramètres détaillés, guide et parcours courriel conservé | Implémentée                      |
| 5. Intégration               | Liens directs, droits existants, traductions FR/EN et retour après connexion           | Implémentée                      |
| 6. Validation                | Build/SSR, lint, tests UI, clavier, accessibilité et captures mobile/desktop           | Vérifiée avec limites ci-dessous |
| 7. Télémétrie complémentaire | Version livrée, observations Web/API, TLS et métadonnées de sauvegarde                 | À réaliser                       |
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
tests `admin-setup-layout.spec.ts`, `admin-setup-email-ui.spec.ts` et
`admin-cockpit.spec.ts` avec `tests/playwright-admin-ui.config.mjs`.
Ils utilisent des API interceptées et des données synthétiques, sans `.env`,
envoi SMTP ni fournisseur réel. Les captures sont dans `test-results/admin-layout/`.
La recette SMTP/OIDC réelle reste celle du guide courriel; ces tests UI ne la
remplacent pas.

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
