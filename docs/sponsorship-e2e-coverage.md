# Couverture E2E commandite et feeds

Cette matrice couvre le parcours commandite de bout en bout au niveau des
routes, contrats API, etats UI, filtres publics, controles de securite, i18n
et documentation de deploiement.

Couverture cible: 9 scenarios sur 9, soit 100%.

| Scenario                                                                         | Couvert | Surface                                                                            |
| -------------------------------------------------------------------------------- | ------- | ---------------------------------------------------------------------------------- |
| Entreprise choisit une commandite, paie et revient avec token                    | Oui     | Fonds, Checkout, API Stripe sans token brut en metadata ni formulaire `session_id` |
| Entreprise rouvre le suivi par token et soumet ses details                       | Oui     | Suivi commandite, API token, retrait du token de l'URL, resoumission idempotente   |
| Token absent, invalide, expire ou introuvable affiche un etat d'erreur           | Oui     | Suivi commandite, validations API                                                  |
| Admin liste les commandites payees avec jeton admin                              | Oui     | Admin, API privee                                                                  |
| Admin approuve, remet en attente, refuse ou rembourse la commandite              | Oui     | Admin, revue DB, remboursement Stripe guide, avoir, PDF et courriel optionnel      |
| Admin prepare et envoie la publication OpenG7/OpenG20 Facebook/LinkedIn          | Oui     | Admin, lots, job social mock/live configurable                                     |
| Page publique affiche seulement les commandites approuvees et consenties         | Oui     | `/commanditaires`, API publique                                                    |
| Navigation FR/EN, prerender, sitemap et docs de prod restent alignes             | Oui     | Routes, i18n, deployment                                                           |
| Page de suivi commandite en etat `pending_review` (avant soumission des details) | Oui     | Suite suivi, statut UI et affichage en attente de details d'entreprise             |

Limite volontaire: l'E2E local publie via `SOCIAL_PUBLICATION_MODE=mock`, pas
avec de vrais tokens Facebook ou LinkedIn. Le chemin admin, le job social,
l'idempotence, la cascade de statuts et l'URL publique sont verifies sans
secret ni appel reseau externe.

## Deux niveaux de verification

Le 100% ci-dessus est verifie par `tests/funding-sponsorship-e2e-coverage.test.mjs`,
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
  lot collectif publie via provider social mocke.
- Scenario 8 (navigation FR/EN, sitemap, prerender): couvert par
  `i18n-navigation.spec.ts`, y compris une requete brute sur les routes
  prerendues FR/EN (sans JavaScript) pour verifier le rendu serveur.

Le parcours don individuel (`personal_support`, hors matrice commandite
ci-dessus) est couvert par `personal-donation-navigation.spec.ts`.

La suite Playwright tourne desormais aussi en CI (job `e2e-playwright` dans
`.github/workflows/deploy.yml`), et bloque le deploiement en cas d'echec.
