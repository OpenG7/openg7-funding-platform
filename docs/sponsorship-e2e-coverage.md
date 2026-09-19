# Couverture E2E commandite et feeds

Cette matrice couvre le parcours commandite de bout en bout au niveau des
routes, contrats API, etats UI, filtres publics, controles de securite, i18n
et documentation de deploiement.

Matrice statique : 9 scénarios disposent d'une trace dans les sources. Ce nombre
ne mesure ni la couverture des branches ni une recette avec les fournisseurs réels.
Les [preuves datées et limites actuelles](platform-status.md) complètent cette matrice.

| Scenario                                                                          | Couvert | Surface                                                                            |
| --------------------------------------------------------------------------------- | ------- | ---------------------------------------------------------------------------------- |
| Entreprise choisit une commandite, paie et revient avec token                     | Oui     | Fonds, Checkout, API Stripe sans token brut en metadata ni formulaire `session_id` |
| Entreprise rouvre le suivi par token et soumet ses details                        | Oui     | Suivi commandite, API token, retrait du token de l'URL, resoumission idempotente   |
| Token absent, invalide, expire ou introuvable affiche un etat d'erreur            | Oui     | Suivi commandite, validations API                                                  |
| Admin liste les commandites payees avec jeton admin                               | Oui     | Admin, API privee                                                                  |
| Admin approuve, remet en attente, refuse ou rembourse la commandite               | Oui     | Admin, revue DB, remboursement Stripe guide, avoir, PDF et courriel optionnel      |
| Admin prepare, planifie et envoie la publication OpenG7/OpenG20 Facebook/LinkedIn | Oui     | Admin, calendrier, lots, job social mock/live configurable                         |
| Page publique affiche seulement les commandites approuvees et consenties          | Oui     | `/commanditaires`, API publique                                                    |
| Navigation FR/EN, prerender, sitemap et docs de prod restent alignes              | Oui     | Routes, i18n, deployment                                                           |
| Page de suivi commandite en etat `pending_review` (avant soumission des details)  | Oui     | Suite suivi, statut UI et affichage en attente de details d'entreprise             |

Limite volontaire: l'E2E local publie via `SOCIAL_PUBLICATION_MODE=mock`, pas
avec de vrais tokens Facebook ou LinkedIn. Le chemin admin, le job social,
l'idempotence, la cascade de statuts et l'URL publique sont verifies sans
secret ni appel reseau externe.

## Deux niveaux de verification

Le suivi dispose aussi d'une suite navigateur isolée : `yarn test:ui:followup`.
Elle couvre les interactions avec API interceptée, notamment les reprises réseau,
les doubles soumissions, les statuts distincts, les médias et le formulaire FR/EN.
Voir le [détail des travaux et des limites](./sponsorship-followup-improvements.md).
Cette suite complète les contrôles statiques et les scénarios Docker ci-dessous.

Depuis l'assistant admin, « Ouvrir la commandite », les liens des réponses et
les brouillons de relance ou de note ciblent
`/admin/fundraiser/sponsors?sponsorshipId=<UUID de contribution>`.
La page initialise la recherche avec cet identifiant et sélectionne le dossier.
L'API recherche un UUID par égalité exacte avant pagination; un identifiant
introuvable affiche une liste vide. Le bouton de réinitialisation permet de
retrouver la liste complète. Les recherches par nom ou référence restent disponibles.
Les tests `admin-sponsorship-search.test.mjs`, `funding-admin-assistant.test.mjs`
et les scénarios « assistant dossier links » de `admin-assistant.spec.ts`
couvrent ce parcours avec des données simulées.

La présence des neuf scénarios est vérifiée par `tests/funding-sponsorship-e2e-coverage.test.mjs`,
qui confirme que chaque scenario a une trace dans le code source (routes,
fonctions, requetes SQL, cles i18n). C'est une garantie statique: elle ne
lance pas de navigateur et ne verifie pas le comportement a l'execution.

La verification a l'execution, dans un vrai navigateur contre la stack
Docker locale (`yarn test:e2e:playwright`), vit dans `tests/playwright/`. Les
scenarios 1, 2, 3, 4 et 7 y sont entierement couverts depuis le depart. Les
scenarios 5, 6 et 8 ont ete completes par navigateur reel a leur tour:

- Scenario 5 (approuver/remettre en attente/refuser/rembourser): couvert par
  `admin-sponsorship-review.spec.ts`, y compris le remboursement Stripe, la
  creation de l'avoir et le telechargement des PDF de facture et d'avoir. En
  local/CI, le remboursement passe par un mock dev cote API
  (`createDevelopmentRefundResult` dans `apps/funding-api/src/main.ts`, actif
  quand `STRIPE_SECRET_KEY` est vide et `FUNDING_PLATFORM_ENV !== production`)
  plutot que par un vrai appel Stripe.
- Scenario 6 (publication OpenG7/OpenG20 Facebook/LinkedIn): couvert par
  `admin-sponsorship-publication.spec.ts`, jusqu'a l'affichage du placement
  sur `/commanditaires`, et par `admin-publication-batches.spec.ts` pour le
  lot collectif place dans un creneau calendrier puis publie via provider
  social mocke.
- Scenario 8 (navigation FR/EN, sitemap, prerender): couvert par
  `i18n-navigation.spec.ts`, y compris une requete brute sur les routes
  prerendues FR/EN (sans JavaScript) pour verifier le rendu serveur.

Le parcours don individuel (`personal_support`, hors matrice commandite
ci-dessus) est couvert par `personal-donation-navigation.spec.ts`.

La suite Playwright tourne desormais aussi en CI (job `e2e-playwright` dans
`.github/workflows/deploy.yml`), et bloque le deploiement en cas d'echec.

## Matrice navigateur / mobile

Le panneau de dossier commanditaire conserve ses contenus dans sa largeur,
répartit les onglets sur plusieurs lignes et empile les cartes de la vue
d'ensemble lorsque l'espace manque. Sur grand écran, la fiche défile
verticalement avec les actions en bas du panneau. Sur écran plus étroit,
sa hauteur reste libre et le défilement suit la page.

`playwright.config.ts` declare deux projets :

- `chromium` (Desktop Chrome) : la suite fonctionnelle complete. Elle exclut
  les tests marques `@mobile` (`grepInvert`).
- `mobile-chrome` (Pixel 5 emule) : uniquement les tests marques `@mobile`
  (`grep`), incluant le smoke responsive des parcours publics
  critiques (`mobile-public-responsive.spec.ts`) : `/fonds-des-batisseurs`,
  checkout mock local, `/commanditaires`, suivi commandite avec token invalide,
  et redirection admin vers `/admin/login`, ainsi que les scénarios admin
  marqués `@mobile` avec lectures ou mutations interceptées.

Le tag `@mobile` garantit qu'aucun test mutant la base partagee (webhooks,
actions admin, comptabilite, backfill) n'est rejoue sur un second navigateur :
ces specs restent desktop-only. Le smoke mobile n'ecrit rien (le checkout mock
n'ouvre pas de session Stripe), donc il est sur a rejouer sur plusieurs
viewports.

Pixel 5 est un appareil Chromium : la matrice reutilise le binaire deja
installe par `playwright install chromium`, sans telechargement supplementaire
ni changement du script d'installation Chromium. Cette configuration Docker
reste distincte des suites `test:ui:public-journeys` et
`test:ui:platform-accessibility`, qui utilisent Chromium, Firefox, WebKit et
mobile WebKit avec API interceptée. Installer ces navigateurs avec
`yarn exec playwright install --with-deps chromium firefox webkit`.

`corepack yarn test:e2e:playwright` execute les deux projets en serie
(`workers: 1`).
