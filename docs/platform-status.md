# État de la plateforme

Référence : état du dépôt au 19 septembre 2026. Le code et les contrats présents
font foi; les analyses MVP antérieures sont historiques. Une fonctionnalité
visible et une preuve sur les fournisseurs réels sont deux informations distinctes.
L'[index documentaire](README.md) oriente vers les guides actuels et les archives.

| Domaine                      | Disponible pour l'utilisateur                                                          | Garanties et limites                                                                                                                                                                                  |
| ---------------------------- | -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fonds et Checkout            | Montants configurés, consentements, confirmation serveur et reprise                    | Tests Node, PostgreSQL et navigateur; voir [confirmation des paiements](payment-trust-validation.md). Le parcours fournisseur complet est distinct.                                                   |
| Transparence                 | Totaux, méthode, états de disponibilité et réalisations publiques                      | Projection et UI testées; [contrat actuel](funding-transparency.md). Ne pas interpréter un chargement comme zéro.                                                                                     |
| Commanditaires               | Annuaire paginé, publications réelles, entrée entreprise et récupération               | Tests de consentement, pagination, SSR et UI FR/EN; [périmètre](public-sponsors.md).                                                                                                                  |
| Bâtisseurs                   | Registre paginé et consentements nom/montant distincts                                 | [Contrat et tests](public-builders-and-support.md); le total représente des entrées, pas des personnes uniques.                                                                                       |
| Aide                         | Recherche de contribution, récupération d'accès, contact, participation technique      | FR/EN, clavier et reprise testables; les paiements privés ne passent pas par des issues publiques.                                                                                                    |
| Administration               | Tableau de bord, file de travail, dossiers, publications, factures, courriels et audit | Fonctionnalités présentes, documentées dans les [lots admin](admin-ux-lot-8.md). L'API reste l'autorité d'accès.                                                                                      |
| Accès nominatifs             | OIDC optionnel, MFA, rôles et gestion des comptes/sessions                             | Fournisseur signé local et révocation testés; activation et recette du fournisseur réel encore requises. [Runbook](operations/admin-identity-and-alerts.md).                                          |
| Alertes indépendantes        | Webhook signé pour événements Stripe bloqués/échoués et courriels échoués              | Déduplication/reprises testées; livraison et santé intégrées après activation explicite. Récepteur réel à qualifier.                                                                                  |
| Routage et performance       | Chargement différé des pages secondaires/admin, pages 404 FR/EN                        | Budget initial de production 800/900 ko, 24 routes prérendues; statuts HTTP Nginx et navigation testés.                                                                                               |
| Livraison                    | Images et scripts associés au même SHA complet; livraisons sérialisées                 | Tests du script sur commandes simulées. Le script ne fait plus de `git pull`; il exécute le checkout préparé. Aucune livraison réelle n'est attestée par ces tests.                                   |
| Fournisseurs                 | Stripe, SMTP et stockage S3 intégrés                                                   | Authentification/accès en lecture seule vérifiés; [recette et preuves](operations/integration-rehearsal.md). Livraison courriel et publication média réelles restent à exercer sur une cible de test. |
| Reprise                      | Restauration PostgreSQL/local/S3 et audit en lecture seule                             | Recette applicative sur cibles jetables; rapprochement des URL et fournisseurs requis avant activation. Pas de qualification complète VPS/OVH.                                                        |
| Navigateurs et accessibilité | Suite FR/EN Chromium, Firefox, WebKit et mobile WebKit                                 | Axe, clavier et réagencement automatisés; lecteur d'écran humain, iPhone physique et zoom natif restent à vérifier.                                                                                   |

## Écarts d'exploitation confirmés lors de la revue documentaire

- Suivi du 25 septembre 2026 : les runners SQL partagent un registre avec
  empreintes, verrou et transaction. Les bases existantes sans registre exigent
  une adoption revue de leur historique ; voir la [procédure de migration](operations/database-migrations.md).
- Suivi du 25 septembre 2026 : `services:check` contrôle la configuration du mode
  token/OIDC choisi et du canal d'alertes. Il ne constitue pas une validation MFA
  ou de réception ; voir le [diagnostic](operations/admin-identity-and-alerts.md#diagnostic-de-configuration-avant-recette).
- Suivi du 25 septembre 2026 : le commutateur explicite du worker inclut son
  overlay dans la livraison, la vérification de santé et le rollback. La sauvegarde
  S3 capture les objets courants et permet leur récupération privée sur des cibles vides.

Ces automatisations locales ne constituent pas une migration ou une activation
de production.

## Priorités opérationnelles suivies au 25 septembre 2026

Ce décompte porte sur les sept lots de préparation à l'exploitation identifiés
dans les guides actuels, pas sur toutes les évolutions possibles du produit.
Le suivi des migrations et le cycle de livraison des alertes sont préparés et
testés localement ; **cinq lots de qualification externe restent ouverts**.
L'adoption du registre sur une base existante reste une opération à autoriser.

| Lot                                    | État et preuve encore nécessaire                                                                                          |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Migrations répétables                  | Moteur local/VPS commun et recettes jetables ; adoption de l'historique à préparer pour chaque base existante             |
| Livraison du processus d'alertes       | Cycle préparé, rollback testé sur commandes simulées et santé/reprise sur vrai conteneur; activation réelle distincte     |
| Parcours Stripe test, SMTP et S3 réels | URL et boîte de recette à confirmer ; réception, DNS courriel et politiques privé/public à qualifier                      |
| Accès OIDC réels                       | Client et comptes nominatifs, assertions MFA et révocation à vérifier chez le fournisseur choisi                          |
| Restauration VPS et médias distants    | Flux commun PostgreSQL/S3 et recette navigateur automatisés; exercice complet VPS/OVH et rapprochement encore nécessaires |
| Accessibilité humaine et appareil réel | Lecteur d'écran, zoom natif et iPhone physique à vérifier ; les tests automatisés sont distincts                          |
| Connexions sociales réelles            | Comptes Facebook/LinkedIn, droits et reprise à qualifier ; toute publication reste soumise à son autorisation propre      |

Les critères détaillés et les cibles sont dans les guides de
[recette](operations/integration-rehearsal.md),
[accès et alertes](operations/admin-identity-and-alerts.md),
[restauration](operations/backup-recovery.md) et
[publication](operations/publication-automation.md).

### Preuves de l'automatisation du 25 septembre 2026

- `yarn test` : 352 tests réussis; livraison/révision/rollback et refus des archives inclus.
- Alertes : quatre intégrations PostgreSQL réussies et recette du vrai conteneur
  avec API arrêtée, refus, redémarrage et panne/reprise DB.
- S3 : capture par `backup.sh` et restauration d'archive de 1 003 objets;
  corruption, cible source/occupée, politique publique et interruption refusées.
  L'inspection des politiques/ACL de bucket est simulée; les objets utilisent S3Mock.
- Restauration applicative locale : recette navigateur réussie, avec comparaison
  des tables, montants, documents, médias et travaux en attente.
- Angular production : 699,45 ko initiaux, 24 routes prérendues; 196 parcours publics
  et 28 vérifications de routage/accessibilité réussis, Chromium repris après
  remplacement d'une attente réseau globale par l'attente du chargement de page.
- Lint sans erreur (un avertissement préexistant), syntaxe Bash, Compose et
  contrôles documentaires vérifiés. Reproduction regroupée : `yarn test:automation`.

### Extension de la reprise PostgreSQL/S3 du 25 septembre 2026

Les deux recettes navigateur `local` et `ovh-s3` passent sur des cibles jetables :
tables identiques, montants et PDF conservés, image affichée et médias privés
protégés, files préservées. La panne S3 après l'import laisse un rapport d'échec,
des buckets réservés et l'application arrêtée. La recette S3 séparée de 1 003
objets passe également, ainsi que les 85 tests ciblés de configuration, d'archives
et de rapport. Les inspections de politiques/ACL restent simulées dans S3Mock;
les URL publiques enregistrées et les fournisseurs restent à rapprocher avant
remise en service. Aucun lot de qualification externe n'est clos par ces preuves.

### Audit après restauration du 25 septembre 2026

La CLI `recovery-audit.mjs` contrôle les données restaurées en lecture seule et
produit un rapport distinct, sans autoriser le redémarrage. Les deux recettes
navigateur local/S3 ont réussi avec injection de doublons, incohérences de montants
et de facture, médias absent/corrompu et override social actif. Les tests vérifient
la séparation CAD/USD, les entiers au-delà de `Number.MAX_SAFE_INTEGER`, les
remboursements partiels, les URL source, le refus d'une cible active et l'absence
de mutation des données et du reçu de restauration par l'audit. La recette du
conteneur d'alertes et deux tests ciblés de lecture des médias/rapport passent
également. Voir les [commandes et limites](operations/backup-recovery.md#audit-automatisé-en-lecture-seule).

## Reproduire les validations

Le lot `feat/platform-access-alerts-and-performance` ajoute les routes différées,
un budget du bundle initial de production (avertissement 800 ko, plafond 900 ko),
les pages 404 FR/EN avec statut HTTP 404, les comptes OIDC optionnels avec MFA,
rôles et révocation, et un processus d'alertes indépendant du SMTP.
Les fonctions et préconditions d'activation sont décrites dans le
[runbook accès et alertes](operations/admin-identity-and-alerts.md).

L'interface **Accès et sessions** gère les comptes et sessions. Le mode OIDC
et le canal d'alerte externe attendent leur configuration; ils ne sont pas
activés en production. Les migrations additives `020` et `021` sont livrées,
sans backfill financier.

```sh
yarn install --immutable
yarn lint
yarn exec tsc --noEmit -p tsconfig.json
yarn test
docker pull postgres:16-alpine
docker pull axllent/mailpit:v1.27.4
docker pull adobe/s3mock:5.1.0
node --test tests/integration/*.integration.mjs
yarn exec playwright install --with-deps chromium firefox webkit
yarn test:ui:public-journeys
yarn test:ui:platform-accessibility
yarn test:e2e:acceptance
git diff --check
```

Les intégrations PostgreSQL et la recette Docker utilisent des données jetables.
La suite publique sert le build prérendu et intercepte les API : elle ne valide
pas les fournisseurs. La CI de chaque révision doit être consultée avant de
lui attribuer les résultats d'une autre révision. Le formatage global conserve
des écarts historiques; contrôler les fichiers du changement sans les masquer.

## Preuves locales du 19 septembre 2026

### Lot accès, alertes et performance

Branche `feat/platform-access-alerts-and-performance`, Node 22.23.2 :

| Vérification            | Résultat                                                                                                                             |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Tests Node              | 260 réussis; nouvelle politique de rôles et MFA incluse                                                                              |
| Intégrations jetables   | 47 réussies; OIDC signé, révocation, alertes, recette SMTP et restauration S3/PostgreSQL inclus                                      |
| Régression admin        | 77 tests navigateur réussis                                                                                                          |
| Parcours publics FR/EN  | 60 tests réussis sur Chromium, Firefox, WebKit et mobile WebKit                                                                      |
| Accessibilité et routes | 20 tests réussis sur ces quatre projets; axe, 404, absence des pages admin dans le téléchargement public                             |
| Déconnexion OIDC        | Vérifiée sur les quatre projets, même avec un état navigateur expiré; deux scénarios de connexion/déconnexion historiques revérifiés |
| Compilation             | TypeScript strict et Angular production réussis; 24 routes prérendues                                                                |
| Bundle initial          | 719,94 ko bruts, estimation compressée Angular 180,25 ko; budgets 800/900 ko respectés                                               |
| Lint                    | Aucune erreur; avertissement préexistant dans `scripts/smoke-public.mjs`                                                             |
| Configuration           | Overlay Compose des alertes validé; aucune activation externe                                                                        |

La recette Docker complète a réussi : **168 tests**, dont les statuts HTTP
404 derrière Nginx, avec nettoyage des conteneurs réussi. Stripe est simulé
dans cette recette; les nouvelles garanties OIDC sont couvertes par la recette
d’identité signée et les contrôles navigateur dédiés.

Les captures de la nouvelle page d'accès ont été relues sur mobile. Le dernier
ajustement de droits de consultation a été revérifié avec la suite Node et
l'intégration OIDC, soit 261 tests dans cette exécution ciblée.

Le contrôle Prettier global conserve des écarts historiques. Les fichiers du
lot sont contrôlés séparément; `main.ts`, `funding-admin.service.ts`, `AGENTS.md`
et `ARCHITECTURE.md` conservent leur formatage global préexistant, vérifié dans
`HEAD`, pour éviter une réécriture sans rapport avec le changement.

L'activation OIDC et du canal réel, la réception dans une boîte externe, les
politiques S3 réelles, la restauration complète du VPS et la recette humaine
au lecteur d'écran restent à effectuer. Voir les runbooks liés ci-dessus.

### Lot précédent : fiabilité et parcours publics

Ces résultats concernent la copie de travail de
`feat/platform-reliability-and-public-journeys`, avec Node 22.23.2. Ils ne
constituent ni une exécution de la CI GitHub ni une validation du VPS.

| Vérification                                 | Résultat                                                                              |
| -------------------------------------------- | ------------------------------------------------------------------------------------- |
| Tests Node                                   | 256 réussis                                                                           |
| Intégrations PostgreSQL jetables             | 44 réussies, dont dump/restauration et annuaire paginé                                |
| Parcours publics FR/EN                       | 60 réussis sur les quatre projets navigateur                                          |
| Dernier ajustement de présentation de l'aide | 8 contrôles axe/réagencement réussis, captures desktop et mobile relues               |
| Suivi de commandite et téléversement         | 32 tests navigateur réussis                                                           |
| Compilation TypeScript et Angular            | Réussies, 22 routes prérendues                                                        |
| Lint                                         | Aucune erreur; un avertissement préexistant dans `scripts/smoke-public.mjs`           |
| Bash, Compose et diff                        | Syntaxe de `deploy.sh`, `docker compose config --quiet` et `git diff --check` réussis |

La recette Docker isolée a également réussi : **167 tests**, avec le Web,
l'API et PostgreSQL réels, Stripe simulé et nettoyage des conteneurs réussi.

`format:check` reste en échec sur des fichiers préexistants. Parmi ceux du lot,
seul `apps/funding-api/src/main.ts` conserve un écart global également présent
dans `HEAD`; son ajout reste ciblé. Les autres fichiers du lot passent Prettier.
Les preuves fournisseurs et les vérifications humaines restantes sont décrites
dans la [recette contrôlée](operations/integration-rehearsal.md).

## Livraison reproductible

Le workflow produit `:<SHA complet>` pour les deux images et appelle
`bash scripts/deploy.sh --no-build --revision <SHA complet>`. Le script vérifie
le commit, l'absence de modifications suivies et la concordance des tags avant
ses opérations Docker. Le workflow fixe la révision avant de l'appeler et
empêche des exécutions concurrentes de livraison.

Pour un lancement manuel, préparer explicitement le checkout désiré avant
`deploy.sh`; le script ne le met plus à jour. Les migrations, la sauvegarde et
la vérification de santé suivent les règles d'exploitation existantes. Le lot
précédent des parcours publics ne nécessitait aucun changement de schéma;
le lot actuel ajoute les migrations `020` et `021`. L'endpoint des bâtisseurs
et les parcours d'identité exigent une livraison conjointe du Web et de l'API.
