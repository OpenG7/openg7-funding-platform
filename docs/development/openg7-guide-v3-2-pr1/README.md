# Guide administratif OpenG7 V3.2 PR 1

Le diagnostic du contrôle sélectionné est allégé dans le Guide, son action
principale est proportionnée et les commandes secondaires restent intégrées au
contrôleur existant. Un accord satisfait propose **Consulter l’accord** et un
historique vide explique l’absence d’approbation enregistrée.

Cette première étape applique le pack V3.2 fourni le **20 octobre 2026**. Les
sous-vues Bon consulté / Passage et bilan / Autre préparation restent une étape
ultérieure à spécifier et valider séparément.

## Base et audit initial

L’audit précède les modifications applicatives : branche
`codex/admin-guide-refonte-blueprint`, `HEAD`
`1108d8a9bc0624b598b3926173f54a19275db1f0`. Le worktree applicatif était propre ;
les deux dossiers d’instructions V3.1 et V3.2 étaient non suivis. Le travail est
isolé sur `codex/admin-guide-v3-2-pr1`, à partir de cette révision. La
[PR de la refonte initiale](https://github.com/OpenG7/openg7-funding-platform/pull/367)
constitue sa base.

**Existant confirmé :** CTA direct et approbation déjà uniques dans le Guide,
sélection conservée après relecture, contrôles applicables dérivés des faits du
serveur, deux conducteurs distincts et commandes liées au contrôle, au dossier
et à leur révision. L’approbation utilise le reçu partagé, sa confirmation,
`expectedVersion`, `requestId` et la réconciliation habituelle.

**Écarts constatés :** le descripteur d’un accord satisfait conservait le libellé
« Compléter l’accord » ; le menu présentait deux fermetures Retour ; l’historique
vide rendait le focus au bon sans explication. Les captures montrent aussi
l’empilement de surfaces et le CTA occupant toute la largeur sur ordinateur.
La réduction des cadres est une amélioration ergonomique, sans défaut financier
déduit de leur apparence.

Dans l’inventaire suivant, `V` est la version du bon et `S` la révision de
l’assistance. Les secondaires communs du Guide sont Campagnes, Historique et
Retour. Les droits de mutation restent vérifiés par l’API et l’écran propriétaire.

| Contrôle et version                                      | CTA avant cette étape                                            | Autres actions                                                                                        | Rôle et capacité                                                     | Effet                                                            | Propriétaire technique                        |
| -------------------------------------------------------- | ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- | ---------------------------------------------------------------- | --------------------------------------------- |
| Accord incomplet, sans assistance — `V`                  | Compléter l’accord ; inactif sans destination valide             | Secondaires communs ; assistance absente                                                              | Les trois rôles peuvent naviguer vers leurs lectures autorisées      | Navigation                                                       | Descripteurs → reçu → accord du dossier       |
| Accord sans source, assistance disponible — `V:S`        | Compléter l’accord                                               | Examiner inactif : aucun résultat ; Source et Relancer inactifs : aucune source ; secondaires communs | Assistance réservée au propriétaire                                  | Navigation ; aucune relance admissible                           | Projection partagée d’assistance et pilote    |
| Accord avec résultat assisté admissible — `V:S`          | Examiner                                                         | Source et Relancer selon capacités, état du job et source ; secondaires communs                       | Propriétaire                                                         | Consultation ; relance de job seulement sur activation explicite | Assistance existante et son contrôleur        |
| Revue commanditaire ou modération — `V`                  | Effectuer la revue                                               | Secondaires communs                                                                                   | Lecture selon rôle ; décision dans l’écran propriétaire              | Navigation                                                       | Revue du dossier                              |
| Présentation et contenus — `V`                           | Examiner la présentation                                         | Secondaires communs                                                                                   | Droits de l’écran rejoint                                            | Navigation selon le motif réel                                   | Destination du contrôle                       |
| Paiement, consentement, examen ou blocage autonome — `V` | Voir le dossier ; inactif sans destination valide                | Secondaires communs                                                                                   | Lecture selon session et droits                                      | Navigation                                                       | Dossier propriétaire                          |
| Contrôle satisfait conservé — `V` ou `V:S`               | Même famille d’action ; accord encore libellé Compléter l’accord | Secondaires du contexte courant                                                                       | Capacités inchangées                                                 | Consultation                                                     | Pilote et dispatch existants                  |
| Aucun contrôle, bon prêt — `V`                           | Aucun CTA direct ; bouton d’approbation partagé                  | Secondaires communs ; approbation exclue du menu Guide                                                | Lecteur sans approbation ; opérateur/propriétaire selon `canApprove` | Mutation confirmée explicitement                                 | Reçu partagé et propriétaire de l’approbation |
| Contrôle non requis                                      | Aucune entrée projetée                                           | Aucune commande inventée                                                                              | Sans objet                                                           | Aucun                                                            | Projection existante, hors dénominateur       |

La chaîne contrôlée est sélection → projection → descripteur → rendu
`peek/open` → focus/manette → dispatch → propriétaire → confirmation éventuelle
→ version et `requestId` → réponse serveur et réconciliation.

## Changements appliqués

- Le détail du Guide présente le nom, l’état et l’explication sur une surface
  sans encadrés imbriqués. Le nom demeure également dans la liste de sélection.
  Les volets Pourquoi et Assistance conservent leur contenu et leurs états.
- Le CTA garde son descripteur, sa disponibilité, son contexte et son dispatch.
  Il prend sa largeur utile sur ordinateur et peut occuper la largeur disponible
  sur un petit conteneur. Seul le libellé de consultation d’un accord satisfait
  est adapté dans la variante Guide, en FR et EN.
- Le menu `peek/open` reste dans le flux du pilote. Retour est sa seule commande
  de fermeture visible ; Échap et la commande manette du profil actif rendent
  le focus à l’ouvreur. Les motifs d’indisponibilité restent lisibles sur mobile.
- L’action Historique ouvre aussi un état vide explicite dans le Guide. La liste
  demeure celle des approbations reçues du serveur, sans événement ajouté.
- Les variables CSS du contrôleur permettent ces adaptations locales, avec les
  valeurs par défaut des autres hôtes. Campagnes et Publication conservent leurs
  commandes propriétaires et leur confirmation d’approbation.

Les propriétaires modifiés sont le
[pilote](../../../apps/funding-web/src/app/features/funding/components/admin-preparation/preparation-pilot.component.ts),
son template et ses styles, le
[détail du contrôle](../../../apps/funding-web/src/app/features/funding/components/admin-preparation/preparation-issue-detail.component.ts),
le [template du reçu](../../../apps/funding-web/src/app/features/funding/components/admin-preparation/admin-preparation-receipt.component.html),
deux feuilles CSS du contrôleur et les catalogues FR/EN. Les tests sont ajoutés
aux suites de reçus et de lot existantes. Le
[runbook de pilotage](../../operations/admin-pilotage.md#pilotage-de-la-preparation)
décrit les commandes actuelles.

## Captures de comparaison

Ces captures proviennent de Chromium sur l’application compilée, avec le même
bon synthétique `DEMO-PREP-003` et des API interceptées. Avant : build de
`1108d8a9`. Après : sources V3.2 de cette livraison. Le menu ouvert montre aussi
le focus contextuel ; le cadrage mobile suit le défilement nécessaire aux actions.

| Vue                           | Avant                                                   | Après                                                  |
| ----------------------------- | ------------------------------------------------------- | ------------------------------------------------------ |
| Diagnostic, 1536 × 864        | [Bureau avant](captures/before-desktop-diagnostic.png)  | [Bureau après](captures/after-desktop-diagnostic.png)  |
| Actions intégrées, 1536 × 864 | [Menu avant](captures/before-desktop-actions.png)       | [Menu après](captures/after-desktop-actions.png)       |
| Diagnostic, 390 × 844         | [Mobile avant](captures/before-mobile-diagnostic.png)   | [Mobile après](captures/after-mobile-diagnostic.png)   |
| Actions intégrées, 390 × 844  | [Menu mobile avant](captures/before-mobile-actions.png) | [Menu mobile après](captures/after-mobile-actions.png) |

## Recette V3.2 de la première étape

Les scénarios ci-dessous reprennent les identifiants `PR1-*` du pack fourni.
« Passé » désigne la recette sur fixtures et les inspections indiquées, avec les
limites matérielles précisées ensuite. `R` désigne les
[reçus](../../../tests/playwright/admin-preparation-receipts.spec.ts), `A`
l’[assistance](../../../tests/playwright/admin-preparation-assistance.spec.ts),
`P` le [lot](../../../tests/playwright/admin-automatic-portfolio.spec.ts), `S`
la [fiche Publication](../../../tests/playwright/admin-sponsorship-preparation.spec.ts),
`C` [Campagnes](../../../tests/playwright/admin-campaigns.spec.ts), `J` les
[parcours Xbox](../../../tests/playwright/admin-controller-journeys.spec.ts) et
`N` les [tests Node du pilote](../../../tests/preparation-pilot.test.mjs).

| Scénario | État    | Preuve et portée                                                                                                                                           |
| -------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PR1-01   | Passé   | Audit Git avant édition, base et dossiers locaux identifiés.                                                                                               |
| PR1-02   | Passé   | R : un CTA direct, exclu des secondaires, même identifiant.                                                                                                |
| PR1-03   | Passé   | R : intitulé conservé dans liste et détail.                                                                                                                |
| PR1-04   | Passé   | Comparaison visuelle des captures : diagnostic sans cadres imbriqués, CTA proportionné.                                                                    |
| PR1-05   | Passé   | R : bon prêt sans CTA de correction fictif ; diagnostic dérivé des faits présents.                                                                         |
| PR1-06   | Passé   | R : accord satisfait, sélection conservée et consultation de sa cible exacte.                                                                              |
| PR1-07   | Passé   | R : aucun CTA direct sur bon prêt sans contrôle ; N : destinations absentes ou non sûres rejetées.                                                         |
| PR1-08   | Passé   | R : liste dans le flux, aucune nouvelle modale ni écriture à l’ouverture.                                                                                  |
| PR1-09   | Passé   | R : assistance absente pour lecteur/opérateur, sans lecture privée.                                                                                        |
| PR1-10   | Passé   | R : commandes inactives et motifs visibles/accessibles, y compris mobile.                                                                                  |
| PR1-11   | Passé   | R et N : secondaires recalculés selon contrôle, rôle et révision.                                                                                          |
| PR1-12   | Passé   | R : source absente, commandes désactivées et raisons exactes.                                                                                              |
| PR1-13   | Passé   | A : consultation et relance volontaire ; aucune complétion métier implicite.                                                                               |
| PR1-14   | Passé   | R : historique vide explicite et historique réel avec acteur/version.                                                                                      |
| PR1-15   | Passé   | R : ancienne commande rejetée après changement de bon ou version, menu ouvert ; nouveau geste sur la cible exacte. A et N : révision et contexte obsolète. |
| PR1-16   | Passé   | R, A et S : lecteur/opérateur/propriétaire, refus et purge des données ; API simulée.                                                                      |
| PR1-17   | Passé   | R : Pourquoi, Assistance et Autres actions sans POST.                                                                                                      |
| PR1-18   | Passé   | R et S : prêt/incomplet/approuvé, approbation unique du Guide, confirmation et version.                                                                    |
| PR1-19   | Passé   | R, A, P et N : conflit, résultat incertain, relecture et absence de rejeu automatique.                                                                     |
| PR1-20   | Passé   | R : A sur contrôle non sélectionné sélectionne uniquement.                                                                                                 |
| PR1-21   | Passé   | R : A sur contrôle sélectionné ouvre les secondaires.                                                                                                      |
| PR1-22   | Passé   | R : A sur CTA focalisé rejoint son dossier exact sans mutation.                                                                                            |
| PR1-23   | Passé   | R : Retour, B et Échap ferment et rendent le focus ; priorités des confirmations.                                                                          |
| PR1-24   | Passé   | R : profil réaffecté, badges et gestes réellement exécutés.                                                                                                |
| PR1-25   | Passé   | R et J : maintien puis confirmation exigent une nouvelle pression.                                                                                         |
| PR1-26   | Passé   | R : flèches, Home/End, Tab/Shift+Tab et retour du focus à l’ouvreur.                                                                                       |
| PR1-27   | Passé   | R : 390 × 667, 390 × 844 et 1536 × 864 ; P : réduction et réouverture du Guide non modal.                                                                  |
| PR1-28   | Partiel | R : viewport effectif 1536 × 864 et mise en page 768 × 432 ; zoom natif/Windows non exécuté.                                                               |
| PR1-29   | Passé   | R : échantillon FR/EN, trois thèmes, mouvement réduit et audit Axe sans violation.                                                                         |
| PR1-30   | Passé   | C et S : résumé, liens, droits, version et approbation dans les autres hôtes.                                                                              |
| PR1-31   | Passé   | P : réduction pendant POST, résultat confirmé ou incertain relu après réouverture/reload, aucun rejeu.                                                     |
| PR1-32   | Passé   | R : positions numérotées, précédent/suivant et progression serveur indépendants.                                                                           |

## Vérifications exécutées

Recette du **20 octobre 2026**, Node **22.23.3**, Yarn **4.9.4** :

- **185 scénarios Playwright réussis ensemble** sur le build final en
  **4,4 minutes**, avec quatre workers : 164 de non-régression et 21 propres à
  V3.2. Ils comprennent les captures et les 17 parcours Xbox existants. Le badge
  du CTA mobile est aussi vérifié visuellement et par une assertion d’aspect.
- **15 tests Node du pilote réussis** ; compilation TypeScript applicative et
  compilation des tests UI réussies.
- Build Angular de production réussi : **25 routes prérendues**, initial
  **505,48 ko** ; enveloppe de chargement initial identique à la base.
- ESLint global : **zéro erreur**, un avertissement préexistant dans
  `scripts/smoke-public.mjs:165`. Les deux fichiers de tests modifiés passent
  aussi leur contrôle ciblé après les derniers ajouts.
- Format ciblé, standards OpenG7, budgets/liens documentaires et
  `git diff --check` réussis. Les liens locaux et les huit captures de ce
  dossier sont vérifiés séparément.

Les essais intermédiaires ont corrigé trois conditions de recette : un lancement
Node pendant le nettoyage du build Angular ne trouvait plus son module compilé
(compilation relancée avant les 15 succès) ; le zoom CSS agrandissait les panneaux
en `dvh`, au lieu de reproduire le viewport d’un zoom navigateur ; enfin, le test
de réduction attendait `review` alors que le conducteur prévoit bien `paused`
après une réponse confirmée. Les reprises ciblées passent avec ces attentes
corrigées ; aucune modification métier n’a été nécessaire.

Commandes exécutées depuis la racine, avec Node 22 sélectionné explicitement :

```powershell
npm exec --yes --package=node@22 -- node "C:/Program Files/nodejs/node_modules/corepack/dist/yarn.js" workspace @openg7/funding-web build --configuration production
npm exec --yes --package=node@22 -- node node_modules/typescript/bin/tsc -p tsconfig.build.json
npm exec --yes --package=node@22 -- node --test tests/preparation-pilot.test.mjs
npm exec --yes --package=node@22 -- node node_modules/typescript/bin/tsc -p tests/tsconfig.admin-ui.json
npm exec --yes --package=node@22 -- node node_modules/eslint/bin/eslint.js . --ext .ts,.mts
$env:GUIDE_V32_CAPTURE_PHASE = 'after'
npm exec --yes --package=node@22 -- node node_modules/@playwright/test/cli.js test --config tests/playwright-admin-ui.config.mjs tests/playwright/admin-preparation-receipts.spec.ts tests/playwright/admin-automatic-portfolio.spec.ts --grep 'V3.2' --workers 2
npm exec --yes --package=node@22 -- node node_modules/@playwright/test/cli.js test --config tests/playwright-admin-ui.config.mjs tests/playwright/admin-automatic-portfolio.spec.ts --grep 'V3.2 reducing' --workers 1
npm exec --yes --package=node@22 -- node node_modules/@playwright/test/cli.js test --config tests/playwright-admin-ui.config.mjs tests/playwright/admin-preparation-receipts.spec.ts --grep 'V3.2 an obsolete secondary' --workers 2
npm exec --yes --package=node@22 -- node node_modules/@playwright/test/cli.js test --config tests/playwright-admin-ui.config.mjs tests/playwright/admin-preparation-receipts.spec.ts tests/playwright/admin-preparation-assistance.spec.ts tests/playwright/admin-sponsorship-preparation.spec.ts tests/playwright/admin-campaigns.spec.ts tests/playwright/admin-controller-journeys.spec.ts tests/playwright/admin-automatic-portfolio.spec.ts --grep-invert 'V3.2' --workers 2
npm exec --yes --package=node@22 -- node node_modules/@playwright/test/cli.js test --config tests/playwright-admin-ui.config.mjs tests/playwright/admin-preparation-receipts.spec.ts tests/playwright/admin-preparation-assistance.spec.ts tests/playwright/admin-sponsorship-preparation.spec.ts tests/playwright/admin-campaigns.spec.ts tests/playwright/admin-controller-journeys.spec.ts tests/playwright/admin-automatic-portfolio.spec.ts --fully-parallel --workers 4
npm exec --yes --package=node@22 -- node scripts/check-project-standards.mjs
npm exec --yes --package=node@22 -- node scripts/check-agent-docs.mjs
git diff --check
```

## Limites de qualification

Les données, API et entrées Xbox sont simulées. La recette ne qualifie ni une
manette USB/Bluetooth physique, ni Stripe, ni une publication ou un courriel
réels. Le viewport 768 × 432 vérifie une mise en page équivalente à 200 % depuis
1536 × 864 ; le zoom natif du navigateur et l’affichage Windows restent à essayer
sur le poste cible. Les observations historiques et le rapport ne deviennent
pas une lecture actuelle du dossier.

Les sous-vues de la future PR 2 devront préserver bon et contrôle sélectionnés,
focus/scroll, brouillons, requêtes en vol et `requestId`, puis rendre joignable un
checkpoint arrivé hors vue. Elles devront distinguer la relecture de l’état
serveur du checkpoint local, sans reprise ou synchronisation des trois cibles
induites par la navigation.
