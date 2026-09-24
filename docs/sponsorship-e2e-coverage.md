# Couverture E2E commandite et feeds

Cette matrice couvre le parcours commandite de bout en bout au niveau des
routes, contrats API, etats UI, filtres publics, controles de securite, i18n
et documentation de deploiement.

Matrice statique : 9 scénarios disposent d'une trace dans les sources. Ce nombre
ne mesure ni la couverture des branches ni une recette avec les fournisseurs réels.
Les [preuves datées et limites actuelles](platform-status.md) complètent cette matrice.

## Recette navigateur : commandite de 500 CAD et deux destinations

La recette `tests/playwright/sponsorship-publication-acceptance.spec.ts` couvre
le deuxième parcours prioritaire de l’[inventaire](development/end-to-end-scenarios-inventory.md) :
commandite de 500 CAD, dossier et médias, préparation privée, revue humaine,
puis envois Facebook et LinkedIn pour OpenG7. Elle utilise l’API, PostgreSQL,
les workers et le navigateur réels, avec Stripe, SMTP, SMS et réseaux sociaux simulés.
Les requêtes applicatives ne sont pas interceptées.

```sh
yarn test:e2e:acceptance sponsorship-publication-acceptance.spec.ts --project=chromium
```

Le runner Node 22 crée une pile Docker jetable et ignore `.env`. Les paramètres
des deux feeds sont restaurés en fin de test. Captures et preuves JSON sont
conservées sous `test-results/acceptance/`.
La recette conserve la cadence réelle : la préparation peut attendre cinq
minutes après un test précédent, puis chaque envoi attend son échéance et le
prochain passage du worker. Son délai maximal est de douze minutes.

Exécution du 23 septembre 2026 sur `30d37c0` avec les changements locaux :
**1 recette réussie en 4,5 minutes**, sans échec, reprise ni test ignoré.
Les contrôles complémentaires passent : 290 tests Node, 6 tests PostgreSQL
de l’annuaire et 36 tests UI français/anglais sur ordinateur et mobile.
TypeScript, lint (un avertissement préexistant dans `scripts/smoke-public.mjs`)
et builds API/Web passent. Le build Web conserve son avertissement de budget
initial. Ces preuves concernent les fournisseurs simulés, sans publication réelle.

La recette vérifie les étapes suivantes :

1. Paiement de 500 CAD depuis le formulaire et confirmation par webhook signé.
   La contribution conserve une revue en attente et n’apparaît pas publiquement.
2. Soumission de la fiche, du logo et d’une photo avec texte alternatif. Le worker
   prépare une proposition privée par canal, sur des destinations en pause.
   Les coordonnées privées, le message interne et le montant restent hors du texte.
3. Refus de l’approbation sans authentification et sans photo approuvée, puis
   revue des médias dans le dossier. « Accepter et programmer » approuve le
   commanditaire et le contenu exact, en conservant sa fiche Web privée.
4. Modification de Facebook après approbation : l’autorisation est retirée,
   une version obsolète est refusée et LinkedIn peut être envoyé sans que
   Facebook ne parte. Une nouvelle décision explicite autorise ensuite Facebook.
5. Envois à échéance par le worker, page admin fermée. Les résultats conservent
   le mode `mock`, un identifiant simulé et une seule tentative par destination.
   Les lots et brouillons sources ne deviennent pas des publications réelles.
6. Décision distincte de visibilité Web, enregistrée dans le dossier. La fiche et
   ses médias deviennent alors publics, sans divulguer les données privées.
   Le rejeu du paiement conserve un seul événement d’activité et deux livraisons.

Cette recette qualifie Chromium et les deux destinations OpenG7 en simulation.
Elle ne qualifie pas les comptes réels, OpenG20, les incidents fournisseur,
les publications collectives de plusieurs commanditaires ni tous les cas de
reprise. Les contrôles d’intégration du moteur conservent leur périmètre propre.
Point UX restant : l’enregistrement de l’éditeur de visibilité peut lever le
masquage Web avec le statut feed `planned`, sans confirmation supplémentaire.
Le bouton « Enregistrer » décide actuellement de cette visibilité, sans
confirmation dédiée à la mise en ligne de la fiche.
Le texte alternatif est nécessaire pour joindre une image à une publication,
même si la revue du média a été acceptée sans description. Le simulateur Stripe
prend aussi en charge la mise à jour des métadonnées du PaymentIntent utilisée
par le suivi commanditaire ; cette opération ne change aucun fait de paiement.
La projection de l’annuaire a été corrigée pendant cette recette : le message
privé du suivi n’est plus retourné ni utilisé comme texte public de remplacement.
Le [contrat de confidentialité](public-sponsors.md#visibilité-et-confidentialité)
conserve le champ historique `message` à `null` et expose le résumé public admin.

## Recette navigateur : paiement invalidé après programmation

La recette `tests/playwright/publication-payment-ineligibility-acceptance.spec.ts`
traite la quatrième priorité de l’[inventaire](development/end-to-end-scenarios-inventory.md) :
**publication autorisée → remboursement ou contestation → blocage avant envoi**.
Elle utilise le navigateur, l’API, PostgreSQL et le worker réels dans une pile
Docker jetable, avec les fournisseurs simulés, sans interception des requêtes
applicatives ni modification directe de la base par le test.

```sh
yarn test:e2e:acceptance publication-payment-ineligibility-acceptance.spec.ts --project=chromium
```

1. Trois entreprises contribuent chacune 500 CAD depuis le formulaire et le
   Checkout simulé. Des webhooks signés confirment les paiements ; chaque
   entreprise soumet sa fiche, un logo et une photo décrite.
2. L’admin approuve les médias, prépare les propositions par la commande API
   existante et approuve explicitement six publications textuelles dans le
   navigateur : Facebook et LinkedIn pour chacune des trois entreprises.
   Les destinations sont en pause et le moteur arrêté pendant ces décisions.
3. Avant l’échéance, l’admin rembourse intégralement la première entreprise
   depuis son dossier. Le test livre la confirmation Stripe signée ainsi qu’une
   contestation signée pour la deuxième. La troisième reste payée.
4. À l’activation du moteur, les quatre publications devenues inadmissibles
   passent à `blocked` avant leur échéance : autorisation retirée, aucune
   tentative ni identifiant externe, une seule invalidation auditée par livraison.
   Les approbations avec une version ancienne ou courante sont refusées.
5. Le panneau explique « paiement remboursé » ou « paiement contesté » et mène
   au bon dossier. Les contrôles UI distincts vérifient français/anglais,
   ordinateur/mobile, clavier et accessibilité de ce panneau.
6. Navigateur fermé, les deux publications témoins sont envoyées une seule fois
   à échéance en mode `mock`. Le rejeu des événements financiers et des anciennes
   confirmations de paiement conserve les statuts remboursé/contesté, les quatre
   blocages et l’absence d’envoi. Captures et preuve JSON sont conservées sous
   `test-results/acceptance/` ; les réglages du moteur et des feeds sont restaurés.

Le test conserve une échéance réelle et le passage du worker toutes les 30 secondes.
Il couvre Chromium, les deux destinations OpenG7, un commanditaire par publication
et un remboursement intégral. Il ne couvre pas la clôture d’une contestation,
les lots mixtes, tous les motifs d’inadmissibilité, ni les fournisseurs réels.
Une requête sociale déjà envoyée n’est pas rappelée. Le retrait d’une fiche Web
déjà publique reste une décision distincte et n’est pas qualifié par cette recette.
Le moteur contrôlait déjà l’admissibilité ; l’évolution applicative expose le fait
de paiement au panneau et permet d’ouvrir le dossier pour comprendre le blocage.

Exécution du 23 septembre 2026 sur `57d6d4c` avec les changements locaux :
**1 recette réussie en 2,9 minutes**, sans reprise ni test ignoré. Les contrôles
de non-régression des remboursements 200 + 300 CAD et 500 CAD passent dans la même
pile : **3 recettes réussies en 3,3 minutes** au total. Les contrôles
complémentaires passent : 290 tests Node, 37 tests PostgreSQL sur les paiements et
les publications, 19 tests UI du cockpit, TypeScript, lint et builds API/Web.
Le dernier ajustement du message général de blocage est vérifié par le build Web
et les 19 tests UI. Les avertissements existants de lint et de budget du bundle
Web restent présents. Ces preuves concernent uniquement les fournisseurs simulés.

## Recette navigateur : résultat incertain et reprise sans doublon

La recette `tests/playwright/publication-uncertain-recovery-acceptance.spec.ts`
traite le scénario 43 de l’[inventaire](development/end-to-end-scenarios-inventory.md).
Trois entreprises contribuent 500 CAD et soumettent leurs dossiers et médias.
L’admin approuve les présentations et six publications textuelles Facebook/LinkedIn.
Les deux publications témoins sont prévues une minute après les quatre cas d’incident.

```sh
yarn test:e2e:acceptance publication-uncertain-recovery-acceptance.spec.ts --project=chromium
```

Le navigateur, PostgreSQL, l’API et son worker sont réels. Stripe et les réseaux
sociaux sont simulés. L’application conserve le mode `mock`, visible dans le
cockpit ; aucune requête applicative n’est interceptée et le test ne modifie pas
directement la base. Le récepteur HTTP local conserve les publications et les
tentatives pour détecter les doublons, sans les masquer par une déduplication.

1. Sur chaque canal, le récepteur coupe une réponse après création de la
   publication, puis une autre sans création. Les quatre livraisons deviennent
   incertaines : une tentative, aucun succès local et aucune prochaine tentative.
2. La recette redémarre uniquement le service API du projet Docker jetable dont
   elle vérifie le nom et le fichier Compose. Les états et autorisations persistent.
   Les témoins partent ensuite une seule fois : le worker a repris son activité,
   tandis que les livraisons incertaines restent sans nouvelle tentative.
3. L’admin consulte la page du réseau simulé. Pour les publications retrouvées,
   un identifiant d’un autre contenu est refusé, puis le bon identifiant permet
   de confirmer le succès sans nouvel envoi. Une requête sans authentification,
   sans confirmation ou rejouée avec une version obsolète est refusée.
4. Pour les publications absentes, un identifiant inventé ne crée aucun succès.
   L’admin doit saisir le motif de vérification et cocher l’attestation d’absence.
   L’autorisation est retirée ; un passage direct du blocage à l’approbation échoue.
   Un brouillon enregistré et une nouvelle approbation permettent ensuite un envoi.
5. Navigateur fermé, les deux reprises sont envoyées. Chacune a deux requêtes
   fournisseur mais une seule publication créée. Les publications retrouvées et
   les témoins conservent une seule requête et une seule publication. L’audit
   conserve l’incident, la vérification, la nouvelle décision et un seul succès.

Captures et preuves JSON sont conservées dans `test-results/acceptance/`. Les
réglages initiaux des feeds et du moteur sont restaurés en fin de recette.
Le délai maximal est de huit minutes pour respecter les échéances et la cadence
réelle de 30 secondes du worker. Les tests UI séparés couvrent la reprise en
français/anglais, sur mobile/ordinateur, au clavier et avec contrôle d’accessibilité.

La qualification porte sur Chromium, les textes sans image et les deux canaux
OpenG7. Elle ne prouve pas les permissions ou contrats des réseaux réels, ni une
réconciliation d’image. Le redémarrage intervient après persistance de l’incertitude ;
il ne simule pas un arrêt brutal pendant la requête externe. Une attestation humaine
erronée reste capable de provoquer un doublon : le système exige cette décision et
la trace, mais ne prétend pas prouver automatiquement l’absence d’une publication.

Exécution du 23 septembre 2026 sur `0c2e6db` avec les changements locaux :
**recette finale réussie en 4,5 minutes**, sans reprise ni test ignoré. La recette
de paiement devenu inadmissible passe également avec le récepteur HTTP local
(premier passage combiné : deux recettes réussies en 8,5 minutes). Les contrôles
complémentaires passent : 294 tests Node, 37 tests PostgreSQL, 23 tests UI du
cockpit, TypeScript, lint, builds API/Web et images Docker, contrôles documentaires
et `git diff --check`. Les avertissements antérieurs de lint et de budget du
bundle Web subsistent. Le format ciblé passe sauf les écarts préexistants du fichier
`tests/stripe-stub/server.mjs`, conservés hors des trois lignes de raccordement.
Les nouveaux fichiers du simulateur et de la recette sont formatés.

## Recette navigateur : révision d'un dossier approuvé

La recette [sponsorship-revision-acceptance.spec.ts](../tests/playwright/sponsorship-revision-acceptance.spec.ts)
relie les scénarios 22 et 44 de l'[inventaire](development/end-to-end-scenarios-inventory.md).
Une entreprise paie 500 CAD, soumet sa fiche et ses médias, puis l'admin approuve
deux publications futures pour Facebook et LinkedIn. Elle modifie ensuite son
nom depuis le suivi mobile. La sauvegarde automatique et le rechargement gardent
la fiche soumise et les deux autorisations intactes ; seule la soumission explicite
remet le dossier en revue.

Deux variantes vérifient le contrôle avant échéance : le dossier reste en attente,
ou l'admin le réapprouve pendant que le moteur est encore arrêté. Dans les deux
cas, le worker réactivé bloque les anciens envois avec `SPONSOR_REVIEW_REQUIRED`,
retire leur autorisation et laisse une trace d'audit, sans requête au réseau social.
Le panneau explique la nouvelle revue et ouvre le dossier concerné. Les commandes
avec une ancienne version et les approbations directes d'un envoi bloqué échouent.

L'admin saisit ensuite le texte exact révisé et une nouvelle date, enregistre le
brouillon et autorise chaque destination. Une soumission identique répétée par
l'entreprise conserve cette nouvelle autorisation. Le worker publie la nouvelle
version une seule fois par destination, navigateurs fermés. Les reçus locaux
comptent chaque requête et chaque publication ; la facture, le paiement de 500 CAD
et les totaux sont conservés, et la fiche Web reste privée.

```sh
node scripts/admin-acceptance.mjs sponsorship-revision-acceptance.spec.ts --project=chromium
```

La pile utilise l'API, PostgreSQL et les workers réels, avec Stripe, SMTP, SMS et
réseaux sociaux simulés, sans interception applicative ni mutation directe de la
base par cette recette. Les captures et les preuves JSON excluant le jeton de
suivi sont sous `test-results/acceptance/`. Le runner supprime sa pile jetable.

Exécution du 23 septembre 2026 (America/Toronto), sur `3c4af8e` avec les changements
locaux : **2 variantes Chromium réussies en 5,5 minutes**, sans échec, test ignoré
ou instable dans l'exécution finale. Les quatre anciennes autorisations sont
bloquées avant leur échéance et les quatre contenus révisés sont envoyés une
seule fois en simulation après nouvelle décision. La pile a été supprimée.

Les tests PostgreSQL de `publication-automation.integration.mjs` vérifient aussi
la modification entre le contrôle initial et la préparation de l'envoi, puis la
reprise après nouvelle autorisation. Ils couvrent une transaction commencée avant
l'autorisation mais écrivant la modification ensuite : la date de soumission
correspond à l'écriture réelle. Les tests d'interface vérifient l'explication,
le lien clavier et l'absence de débordement en FR/EN à 390 et 1280 pixels.

Contrôles complémentaires du 23 septembre 2026 : **294 tests Node**, **34 tests
PostgreSQL** (`publication-automation`, `sponsorship-access`, `editorial-programme`)
et **27 tests d'interface** (`admin-publication-automation`) réussis. TypeScript,
lint et build Angular de production passent. Le lint conserve un avertissement
préexistant dans `scripts/smoke-public.mjs` ; le bundle initial Angular mesure
817,46 ko pour un budget de 800 ko.

Limites : la révision porte sur les informations du dossier, sans remplacement
ni suppression de médias après approbation. Les modifications concurrentes de
plusieurs onglets, les corrections administratives et les lots collectifs ne sont
pas qualifiés par ces variantes. Une requête déjà transmise au fournisseur ne
peut pas être rappelée. La date de soumission est comparée à celle de l'autorisation
dans PostgreSQL ; aucun nouveau schéma ni migration n'est nécessaire.

## Matrice statique

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
  lot collectif place dans un creneau calendrier puis autorise. La nouvelle
  recette de 500 CAD ci-dessus poursuit jusqu'aux deux envois simules du worker.
- Scenario 8 (navigation FR/EN, sitemap, prerender): couvert par
  `i18n-navigation.spec.ts`, y compris une requete brute sur les routes
  prerendues FR/EN (sans JavaScript) pour verifier le rendu serveur.

Le parcours don individuel (`personal_support`, hors matrice commandite
ci-dessus) est couvert par `personal-donation-navigation.spec.ts`.

La suite Playwright tourne desormais aussi en CI (job `e2e-playwright` dans
`.github/workflows/deploy.yml`), et bloque le deploiement en cas d'echec.

Le seed et le nettoyage (`yarn test:e2e:seed:cleanup`) exécutent leurs écritures
SQL dans une transaction. Ils retirent d'abord les publications simulées des
fixtures, leurs observations éditoriales, récurrences et lots, puis les
commandites et médias associés. Les protections des publications autorisées
restent actives. Un lot partagé avec une commandite hors fixtures ou une
publication en mode `live` bloque le nettoyage sans suppression partielle.
Le test [de nettoyage PostgreSQL](../tests/integration/playwright-fixture-cleanup.integration.mjs)
vérifie ces protections et la réexécution sur une base jetable. La recette
isolée `yarn test:e2e:acceptance` conserve les fixtures pour les diagnostics
avant de détruire sa propre pile.

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
