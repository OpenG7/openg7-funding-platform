# Lot 8 — Recette et preuves d’exécution

Date : 17 septembre 2026. Branche : `test/admin-acceptance`, créée depuis `main` (`7238c51`, lot 7 fusionné).

## Portée

Le lot 8 vérifie les parcours livrés dans les lots 1 à 7 et rend leur recette reproductible localement et dans une PR. Risque modéré : configuration du build Web, routage Nginx et infrastructure de test. Les règles financières et les schémas persistants ne changent pas.

La recette distingue trois niveaux :

| Niveau                       | Ce qu’il prouve                                                                         | Limite                                                                                   |
| ---------------------------- | --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| UI sur fixtures interceptées | États d’erreur, navigation, i18n, focus, réponses tardives, responsive et confirmations | Ne prouve pas la persistance ni un fournisseur externe                                   |
| Intégration PostgreSQL       | Requêtes réelles, migrations, pagination, exactitude, audit, concurrence et idempotence | Ne passe pas par le navigateur                                                           |
| Navigateur sur Docker        | Parcours Web → Nginx → API → PostgreSQL, documents et appels au simulateur Stripe       | Stripe est un simulateur local, SMTP est désactivé et la publication sociale est simulée |

## Parcours utilisateur

Les suites couvrent notamment :

- **À traiter → dossier → revue → retour** : la revue confirmée retire sa tâche, conserve les filtres et produit un audit. La publication reste indépendante de l’approbation.
- **Recherche → facture → détail** : une facture émise par le parcours ciblé est retrouvée, prévisualisée et ouverte avec le bon identifiant de contribution.
- **Courriel → confirmation → retry** : la confirmation affiche le destinataire et le résultat réel de la tentative reste visible. Avec SMTP désactivé, le résultat attendu est un échec d’envoi.
- **Publication** : préparation, affectation à un créneau/lot, confirmation et consultation du résultat public.
- **Remboursement** : remboursement complet et partiel, avoir PDF, refus d’un dépassement cumulatif et rejet d’une version obsolète. Les webhooks et reprises restent couverts par les suites financières existantes.
- **Mobile admin** : lectures réelles sur plusieurs pages, changement de langue, ouverture/fermeture de la recherche et restauration du focus, sans mutation métier.

Les captures sur fixtures couvrent 1672 × 941, tablette et mobile jusqu’à 320 px. Un contrôle supplémentaire mesure le contraste des couleurs de texte du thème sur ses trois surfaces et vérifie le réagencement à 836 px avec une taille de texte doublée, dans les deux langues. Ce dernier contrôle simule les contraintes d’espace et d’agrandissement : il ne pilote pas le zoom natif du navigateur et ne constitue pas un audit exhaustif d’accessibilité.

La structure et les couleurs reprennent la maquette. La page conserve davantage d’explications sur les données, leurs limites et les diagnostics historiques ; sa hauteur ne reproduit donc pas à l’identique l’illustration. Les fixtures du contrôle responsive exercent aussi l’indisponibilité de certains blocs.

## Infrastructure de recette

### Lanceur isolé

```bash
yarn test:e2e:acceptance
```

Prérequis : Node 22, Yarn 4, Docker avec des conteneurs Linux et Chromium installé (`yarn playwright:install`).

`scripts/admin-acceptance.mjs` orchestre `docker-compose.acceptance.yml` :

1. crée un nom de projet unique et sélectionne deux ports locaux disponibles ;
2. vérifie que le daemon Docker est local ;
3. construit les images à partir des Dockerfiles du dépôt ;
4. démarre PostgreSQL et le simulateur Stripe ;
5. applique les migrations puis charge les fixtures ;
6. démarre API et Web et attend leurs contrôles de santé ;
7. exécute les tests navigateur ;
8. collecte les logs en cas d’échec et supprime les conteneurs/réseaux de ce projet dans `finally`.

La base utilise un montage mémoire ; aucun volume de développement n’est réutilisé. PostgreSQL n’a pas de port publié dans cette pile. Les ports Web et simulateur Stripe sont liés à `127.0.0.1`. L’API rejoint uniquement le réseau interne de test.

L’environnement du processus est filtré : les paramètres applicatifs hérités, identifiants fournisseurs, URL de base et choix de projet Compose ne sont pas transmis. Les scripts de migration et de seed lisent un fichier d’environnement temporaire vide via `OPENG7_E2E_ENV_FILE`. Les appels Compose imbriqués partagent le même fichier et le même projet explicites.

`OPENG7_E2E_ISOLATED`, `OPENG7_E2E_ENV_FILE` et `ACCEPTANCE_*` sont des paramètres internes au lanceur. Ils ne sont pas à ajouter au `.env` applicatif. Les anciennes commandes Docker restent disponibles pour le développement ; la recette utilise la nouvelle commande isolée.

En cas d’arrêt brutal empêchant le `finally` de s’exécuter, le nom exact du projet figure dans `test-results/acceptance/run.json`. Inspecter cette cible avant tout nettoyage manuel. Une nouvelle exécution utilise un autre projet.

### Répartition des suites

- `tests/playwright-admin-ui.config.mjs` définit les sept fichiers de tests UI entièrement interceptés.
- La configuration Docker isolée réutilise cette liste pour les exclure de sa propre exécution. Le workflow lance les deux niveaux séparément.
- Les suites Docker mixtes peuvent intercepter une erreur ou un Checkout pour une assertion ciblée ; leurs autres parcours utilisent l’API réelle.
- Les mutations métier sont exécutées sur un seul projet Chromium avec un seul worker. Les scénarios `@mobile` sont des lectures ou des parcours aux mutations interceptées.
- Les retries automatiques sont désactivés dans la recette isolée : rejouer seulement un test après une mutation pourrait rencontrer une fixture déjà modifiée. Une relance complète recrée la base.

### PostgreSQL sans configuration manuelle

Les cinq suites admin précédemment conditionnées par `*_TEST_DATABASE_URL` utilisent maintenant `startDisposablePostgres`. Elles s’exécutent systématiquement, chacune sur son propre conteneur local. Elles conservent leur vérification d’une base vide et appliquent elles-mêmes les migrations grâce à l’option `migrate: false` du helper.

```bash
docker pull postgres:16-alpine
yarn test:integration:payments
```

Cette commande couvre aussi les suites admin malgré son nom historique. Les bases temporaires sont supprimées en fin de test, y compris après un échec.

### CI de pull request

`.github/workflows/admin-acceptance.yml` lance le lint, le contrôle TypeScript complet, les tests Node, les intégrations PostgreSQL, le build Angular/SSR, les tests UI et la recette Docker. Les preuves sont conservées pendant sept jours dans l’artefact `admin-acceptance-results`.

Ce workflow est limité aux validations. La première exécution sur GitHub a réussi pour la PR #116 ; les révisions et preuves sont consignées dans la section « Résultats CI » ci-dessous. Chaque changement ultérieur doit être validé sur sa propre révision.

### Lecture des preuves pour une PR

1. Ouvrir l’exécution **Admin acceptance** associée au dernier commit de la PR et relever son URL et le SHA testé. Une fusion de PR ne constitue pas à elle seule une preuve de réussite.
2. Vérifier la conclusion du job et de chaque étape : lint, TypeScript, tests Node, intégrations PostgreSQL, UI/SSR et Docker. Une étape ignorée, annulée ou encore en cours n’est pas validée.
3. Télécharger l’artefact `admin-acceptance-results` avant son expiration. Le rapport Docker est `acceptance/results.json` ; `acceptance/run.json` identifie la révision, le projet temporaire et la date. Les captures UI se trouvent sous `admin-layout/`.
4. Comparer les compteurs du rapport avec les logs. Consigner les échecs, tests ignorés ou instables et vérifier le nettoyage Docker. Ne pas appliquer les résultats d’une ancienne exécution à un nouveau commit.
5. En cas d’échec, examiner les traces et erreurs, corriger puis relancer la recette entière sur une base neuve. Les sorties ignorées par Git restent dans l’artefact ; le bilan versionné conserve les liens, les révisions et les conclusions.

Cette vérification concerne la recette sur données synthétiques. Elle ne remplace pas les contrôles de l’environnement livré ni ceux des fournisseurs réels.

## Corrections issues de la recette

| Problème observé                                                            | Correction                                                                            |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Le Dockerfile Web utilisait Node 20 malgré le runtime 22 du dépôt           | Alignement du builder sur Node 22                                                     |
| Une route prérendue sans slash redirigeait vers le port interne 8080        | Redirections Nginx relatives avec `absolute_redirect off`, vérifiées par un test HTTP |
| Les traces et captures gonflaient le contexte de build Docker               | Exclusion de `test-results` et `playwright-report` dans `.dockerignore`               |
| Recherche locale ambiguë depuis l’ajout du dialogue global                  | Sélecteurs accessibles exacts dans les parcours existants                             |
| Certaines suites contournaient involontairement les nouvelles confirmations | Étapes de confirmation ajoutées pour retry, publication et export privé               |
| Assertions Assistant et champ d’URL de logo devenus obsolètes               | Attentes alignées sur les libellés et contrôles effectivement présents                |
| Deux tests assimilaient encore le retour Checkout à un paiement confirmé    | Attente de confirmation serveur vérifiée ; les assertions de webhook restent en place |
| Fixture de suivi média trop courte pour atteindre le chargement             | Token synthétique de longueur admissible                                              |
| Déclarations de fixtures incomplètes et import ESM sans extension           | Déclarations complétées et extension explicite ; contrôle TypeScript global rétabli   |
| Une assertion PostgreSQL attendait des nombres pour des `BIGINT`            | Comparaison avec les chaînes décimales exactes retournées par `pg`                    |
| Le lint analysait des déclarations temporaires sous `test-results`          | Exclusion des sorties de test, avec contrôle TypeScript conservé sur les sources      |

## Résultats

Validation locale du 17 septembre 2026, exécutée avec Node 22 et Yarn 4 sur la branche non commitée :

| Validation                                        | Résultat                                                                                         |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `yarn test`                                       | 230 tests réussis, aucun échec ni test ignoré ; compilation TypeScript incluse                   |
| `node --test tests/integration/*.integration.mjs` | 23 tests PostgreSQL réussis, aucun échec ni test ignoré                                          |
| `yarn test:ui:admin`                              | 77 tests UI réussis ; build Angular/SSR réussi avec 22 routes prérendues                         |
| `yarn test:e2e:acceptance`                        | 121 tests navigateur réussis, aucun échec, test ignoré ou résultat instable ; retries désactivés |
| `yarn exec tsc --noEmit -p tsconfig.json`         | Réussi                                                                                           |
| `yarn lint`                                       | Réussi : aucune erreur ; un avertissement préexistant dans `scripts/smoke-public.mjs:165`        |
| Prettier sur les fichiers du changement           | Réussi                                                                                           |
| `yarn format:check` global                        | Échec : écarts de formatage historiques dans le dépôt                                            |
| `git diff --check`                                | Réussi                                                                                           |

La dernière recette Docker locale est sortie avec le code 0. Ses conteneurs et réseaux ont été supprimés ; les services PostgreSQL et simulateur Stripe déjà présents avant la recette sont restés actifs. Ces résultats portent sur l’arbre de travail local de l’implémentation initiale ; la validation CI du code ensuite commité est décrite ci-dessous.

Les fichiers `test-results/acceptance/results.json`, `run.json`, les captures et les traces sont des sorties locales ignorées par Git. Le rapport JSON distingue les tests attendus, échoués et ignorés ; le code de sortie reste non nul en cas d’échec, y compris pendant le nettoyage.

### Résultats CI — PR #116

Le 17 septembre 2026, l’exécution [Admin acceptance #1](https://github.com/OpenG7/openg7-funding-platform/actions/runs/35287062740) s’est terminée avec la conclusion **success**. Le [job et ses logs](https://github.com/OpenG7/openg7-funding-platform/actions/runs/35287062740/job/105421647155) ont été consultés après sa fin. Toutes les étapes ont réussi.

| Preuve                     | Résultat observé sur Ubuntu 24.04, Node 22 et Yarn 4                                  |
| -------------------------- | ------------------------------------------------------------------------------------- |
| Lint et TypeScript complet | Réussis ; le lint conserve son avertissement préexistant                              |
| Tests Node                 | 230 réussis, aucun échec ni test ignoré                                               |
| Intégrations PostgreSQL    | 23 réussis, aucun échec ni test ignoré                                                |
| Angular/SSR et UI          | Build réussi, 22 routes prérendues et 77 tests réussis                                |
| Navigateur sur Docker      | 121 tests réussis, aucun échec, test ignoré ou résultat instable ; retries désactivés |
| Nettoyage                  | Les quatre conteneurs et les deux réseaux du projet de recette ont été supprimés      |
| Artefact                   | `admin-acceptance-results` conservé, expiration le 24 septembre 2026 à 23:38 UTC      |

La [PR #116](https://github.com/OpenG7/openg7-funding-platform/pull/116) portait le commit `9426ec0b09ac0146dcd21efa38dd709e93f5b267`. GitHub Actions a testé son commit de fusion temporaire `06439a9b2bd2a910d3b04aec712b328ebacdfcdd`, visible dans les logs de checkout. Le commit fusionné dans `main` est `2511b5041f567f8765d40bd7e48a9b2f09c31900` ; son arbre de fichiers est identique à celui de la tête de PR (`e4b006aa72f6a0dc884f6a0e686bd1592528fcf9`).

L’[artefact de recette](https://github.com/OpenG7/openg7-funding-platform/actions/runs/35287062740/artifacts/10524559008) porte l’identifiant `10524559008`. Il a été téléchargé et son empreinte SHA-256 vérifiée contre celle publiée par GitHub : `d60cb692d72eeea7ba9ff9d1412aab5b0653a2d900d913037dd0c2d155a9edaf`. `acceptance/run.json` confirme la révision testée et un arbre de travail propre ; `acceptance/results.json` confirme les 121 succès et zéro échec, test ignoré ou résultat instable. Cette preuve concerne la recette de PR ; elle n’atteste pas un déploiement ni le fonctionnement des fournisseurs réels.

Le suivi sur `chore/admin-acceptance-followup`, créée depuis `2511b50`, actualise les commandes de reproduction des lots 2 à 6 et consigne ces preuves. Il est documentaire : format ciblé, liens locaux et diff vérifiés ; les suites applicatives ne sont pas relancées pour ces seuls changements de texte.

## Livraison et limites

- Aucune migration supplémentaire, dépendance ou variable d’environnement de production.
- Le correctif Nginx et le runtime de build nécessitent une reconstruction de l’image Web lors de la livraison normale.
- Une recette locale ne prouve pas les accès réels à Stripe, SMTP, au stockage distant ou aux réseaux sociaux. Ces vérifications relèvent de la recette d’environnement avec ses accès et son autorisation propres.
- Les snapshots de documents, textes saisis et messages externes conservent leur langue d’origine.
- Le formatage global présente encore des écarts historiques. Le changement ne reformate pas l’ensemble du dépôt.

La recette locale et la recette CI du périmètre initial sont validées. Pour la suite, définir un nouveau lot à partir des besoins produit restants et des limites ci-dessus ; le plan initial ne prévoit pas de lot 9.
