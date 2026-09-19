# État de la plateforme

Référence : état du dépôt au 19 septembre 2026. Le code et les contrats présents
font foi; les analyses MVP antérieures sont historiques. Une fonctionnalité
visible et une preuve sur les fournisseurs réels sont deux informations distinctes.

| Domaine                      | Disponible pour l'utilisateur                                                          | Garanties et limites                                                                                                                                                                                  |
| ---------------------------- | -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fonds et Checkout            | Montants configurés, consentements, confirmation serveur et reprise                    | Tests Node, PostgreSQL et navigateur; voir [confirmation des paiements](payment-trust-validation.md). Le parcours fournisseur complet est distinct.                                                   |
| Transparence                 | Totaux, méthode, états de disponibilité et réalisations publiques                      | Projection et UI testées; [contrat actuel](funding-transparency.md). Ne pas interpréter un chargement comme zéro.                                                                                     |
| Commanditaires               | Annuaire paginé, publications réelles, entrée entreprise et récupération               | Tests de consentement, pagination, SSR et UI FR/EN; [périmètre](public-sponsors.md).                                                                                                                  |
| Bâtisseurs                   | Registre paginé et consentements nom/montant distincts                                 | [Contrat et tests](public-builders-and-support.md); le total représente des entrées, pas des personnes uniques.                                                                                       |
| Aide                         | Recherche de contribution, récupération d'accès, contact, participation technique      | FR/EN, clavier et reprise testables; les paiements privés ne passent pas par des issues publiques.                                                                                                    |
| Administration               | Tableau de bord, file de travail, dossiers, publications, factures, courriels et audit | Fonctionnalités présentes, documentées dans les [lots admin](admin-ux-lot-8.md). L'API reste l'autorité d'accès.                                                                                      |
| Livraison                    | Images et scripts associés au même SHA complet; livraisons sérialisées                 | Tests du script sur commandes simulées. Le script ne fait plus de `git pull`; il exécute le checkout préparé. Aucune livraison réelle n'est attestée par ces tests.                                   |
| Fournisseurs                 | Stripe, SMTP et stockage S3 intégrés                                                   | Authentification/accès en lecture seule vérifiés; [recette et preuves](operations/integration-rehearsal.md). Livraison courriel et publication média réelles restent à exercer sur une cible de test. |
| Reprise                      | Scripts de sauvegarde et restauration; exercice PostgreSQL jetable                     | Dump/restauration réelle sur conteneurs temporaires; pas de preuve de restauration complète du VPS ou des médias distants.                                                                            |
| Navigateurs et accessibilité | Suite FR/EN Chromium, Firefox, WebKit et mobile WebKit                                 | Axe, clavier et réagencement automatisés; lecteur d'écran humain, iPhone physique et zoom natif restent à vérifier.                                                                                   |

## Reproduire les validations

```sh
yarn install --immutable
yarn lint
yarn exec tsc --noEmit -p tsconfig.json
yarn test
docker pull postgres:16-alpine
node --test tests/integration/*.integration.mjs
yarn exec playwright install --with-deps chromium firefox webkit
yarn test:ui:public-journeys
yarn test:e2e:acceptance
git diff --check
```

Les intégrations PostgreSQL et la recette Docker utilisent des données jetables.
La suite publique sert le build prérendu et intercepte les API : elle ne valide
pas les fournisseurs. La CI de chaque révision doit être consultée avant de
lui attribuer les résultats d'une autre révision. Le formatage global conserve
des écarts historiques; contrôler les fichiers du changement sans les masquer.

## Preuves locales du 19 septembre 2026

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
la vérification de santé suivent les règles d'exploitation existantes. Aucun
changement de schéma n'est requis par ce lot. Le nouvel endpoint des bâtisseurs
exige une livraison conjointe du Web et de l'API.
