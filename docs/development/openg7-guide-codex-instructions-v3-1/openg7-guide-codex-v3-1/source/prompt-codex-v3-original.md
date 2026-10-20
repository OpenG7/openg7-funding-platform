# Prompt Codex — OpenG7 Guide administratif V3 (post-refonte réelle)

Tu interviens dans `openg7-funding-platform`, sur le panneau **non modal** `AdminGuidanceComponent`, après la refonte du **19 octobre 2026**. Les documents de référence dans ce paquet sont :

- `openg7-guide-administratif-blueprint-v3.md` : diagnostic, proposition, tableau d'écarts G3-01 à G3-17 et critères d'acceptation ;
- `source/README-original.md` : blueprint réel fourni, état `30e812a6e9f981e67a92022e040c84b7fdbd4bf2` **avec modifications locales non commitées** ;
- `captures/01-decouverte-desktop.png` à `captures/07-parcours-accord-desktop.png` : images de recette synthétique ;
- les blueprints métiers actuels du dépôt.

## Objectif

Implémenter **progressivement la V3 de présentation/ergonomie**, sans recréer le Guide, modifier les permissions API, transformer une préparation en approbation ni retirer une fonction déjà livrée. Le travail précédent a DÉJÀ livré : quatre modes avec libellés, CTA prioritaire, contrôles « Vérifiés » repliables, carrousel numéroté, réessai des imports différés, focus, réconciliation et thème décoratif. **Ne les recrée pas.**

## Phase 0 — Audit obligatoire avant tout changement

1. Vérifie `git status`, la branche, la révision locale et la présence des **modifications non commitées**. Ne les écrase pas ; si le contexte ne correspond pas au README, rapporte l'écart avant toute transformation destructive.
2. Inspecte les propriétaires existants :
   - `components/admin-guidance/*`, `services/admin-guidance.service.ts`, `components/admin-layout/*` ;
   - `components/admin-automatic/admin-automatic.component.ts`, `admin-automatic-portfolio*`, `admin-automatic-portfolio-run.ts`, `admin-preparation-carousel.component.ts`, `admin-automatic.service.ts` ;
   - `components/admin-preparation/admin-preparation-receipt*`, `preparation-pilot*`, `preparation-issue-list*`, `preparation-context-actions.ts` ;
   - `components/admin-controller/*`, `components/admin-pilotage/controller.service.ts`, `components/admin-context-controller/*` ;
   - `services/admin-confirmation.service.ts` et catalogues i18n FR/EN.
3. Mets en regard le rendu courant avec les sept captures (ce sont des états de test, pas la vérité de production). Pour chaque constat, classe **présent / améliorable / hypothèse à confirmer**.
4. Produis un mini-rapport initial : quels composants modifier, quelle sémantique conserver, quels tests cibler et quels risques de régression existent.

## Lot A — P1 : bonne cible et intention explicite

- Implémente une projection **de présentation** des cibles indépendantes lorsque connues : bon consulté (`carousel.position`/version), prochain dossier du passage (`run.nextContributionId`) et paiement explicitement suivi (`guidance.snapshot().payment`). Ne fusionne pas les IDs ; ne fais aucune mutation lors de la sélection de bon ou de la vue.
- Présente de manière concise les divergences et la **cible exacte** de chaque action ; les informations absentes ne doivent pas être inventées. Sur petit écran, un contrôle accessible permet d'afficher ces cibles.
- Inspecte « Examiner le dossier » et « Voir le suivi » dans le bilan/rapport : comme l'action suspend le lot et démarre une préparation ciblée, révise le libellé ou l'explication **avant le geste**, en tenant compte des traductions et des confirmations déjà existantes. Ne te contente pas d'un renommage si la conséquence réelle varie selon l'état.
- Aligne l'état visuel des boutons de mutation du lot sur le rôle/capacités retournées ; le serveur reste la seule autorité. En lecture seule, préserver les consultations et expliquer la raison d'indisponibilité.
- Distingue explicitement **Reprendre le passage**, **Revérifier le même manifeste** et **Démarrer un nouveau passage incluant des paiements nouveaux** (selon l'admissibilité), sans changer leurs méthodes ou conditions métier.

## Lot B — P1 : compacité et navigation sans cycles de vie dupliqués

- Dans le mode Préparation uniquement, propose des **vues de présentation** : « Bon consulté », « Passage et bilan », « Autre préparation ».
- Ces choix ne sont **ni des routes ni des commandes de lot**. Les changements de vue ne doivent pas exécuter POST, relancer une préparation, modifier le paiement suivi, pauser le conducteur, perdre une requête en vol ou créer un nouveau `requestId`.
- Préserve les composants existants et leurs états ; veille à ne pas démonter/remonter une machine active de façon destructrice. Laisse le checkpoint obligatoire accessible depuis la vue Bon, avec un lien vers Passage.
- Dans « Passage et bilan », sépare lisiblement état/commandes, dernier résultat, métriques du bilan et rapport historique daté. Préserve la pagination, les preuves et l'audit. Les indicateurs `remaining`, `unknown`, `unverified` se recoupent : **ne jamais les additionner**.
- Mobile 320/390 px : compacter l'en-tête et rendre les modes atteignables après défilement ; ne pas créer une navigation double désynchronisée. Protéger le CTA, l'approbation, la navigation carrousel et les confirmations de tout recouvrement par footer ou dock.
- Respecter le panneau **non modal**, sans overlay de blocage ni confinement de focus, même si le mode Préparation est agrandi.

## Lot C — P1 : clavier, focus, profil Xbox

- Vérifie la différence entre ordre HTML/DOM et ordre visuel du bon partagé. Corrige uniquement les ruptures constatées, en conservant le rendu et les autres consommateurs (Campagnes, onglet Publication).
- Montre « prochain geste » depuis les **descripteurs existants et le profil courant** : A sur contrôle sélectionné peut ouvrir Autres actions, A sur CTA l'active ; B/Y dépendent du contexte. Ne fige pas A/B/X/Y dans de nouveaux handlers.
- Priorité absolue aux confirmations et dialogues de réconciliation. Maintien d'A, retour au neutre, LB/RB et touches Home/End doivent respecter le comportement actuel.
- Quand le Guide réduit ou met en pause pendant une requête, indiquer que la requête serveur peut finir ; à la reprise, consulter/reconcilier sans renvoi arbitraire.

## Lot D — P2 : précision des libellés, données et présentation

- Distinguer dans la présentation position du bon, progression du lot et contrôles satisfaits ; pour deux lectures séparées, exposer l'instant de lecture ou ne pas créer de contradiction.
- Contrôle choisi mais vérifié : le CTA doit refléter le descripteur et l'état réellement admissible, ne pas promettre « Compléter » sans manque actuel.
- Rapport détaillé historique vs dernier résultat courant : conserver source, date, acteur, preuve et avant/après ; diminuer leur duplication visuelle.
- `uncoveredCount = 0` dans la projection actuelle n'est pas une preuve exhaustive de couverture ; éviter toute affirmation générale de couverture.
- « Organisation proposée — à réaliser » dans Six parcours n'est pas une fonctionnalité livrée.
- Le chargement asynchrone i18n du mode doit avoir un état compréhensible (FR/EN), sans flash trompeur de boutons actifs.
- Garder panorama/portrait optionnels, vrais focus, contrastes et mouvement réduit en thèmes clair/nuit/graphite.

## Invariants non négociables

1. Paiement ≠ offre acceptée ≠ consentement ≠ revue ≠ modération ≠ préparation approuvée ≠ visibilité Web ≠ autorisation sociale ≠ preuve de livraison ≠ courriel remis.
2. L'approbation de la préparation reste une action **unique**, dans le composant partagé, avec `canApprove`, rôle, version, confirmation humaine, `requestId`, audit et API.
3. Une sélection de contrôle, une navigation de carrousel, un changement de vue, une lecture guidée ou une ouverture du Guide **ne sont pas** des approbations ni des vérifications serveur.
4. `Revérifier` conserve le manifeste figé ; nouveau passage nécessaire pour inclure les paiements nouveaux.
5. Réconciliation avant tentative répétée lorsqu'un résultat est incertain ; ne rejoue pas une mutation pendant rechargement/réduction.
6. Préserver les sélecteurs `data-og7`, FR/EN, SSR, import différé et les routes/onglets existants.
7. Aucune duplication du moteur de lot, des contrats `funding-core`, des contrôles d'autorisation ou des formulaires métiers.

## Tests et critères de sortie

- Reprendre les recettes existantes : `admin-guidance.spec.ts`, `admin-workflow-guide.spec.ts`, `admin-automatic-portfolio.spec.ts`, `admin-preparation-receipts.spec.ts`, `admin-preparation-assistance.spec.ts`, `admin-sponsorship-preparation.spec.ts`, `admin-campaigns.spec.ts`, `admin-controller-journeys.spec.ts`.
- Compléter selon les 22 scénarios du V3 : cibles B/C/A divergentes, actions lecteur, changement de vue sans POST, bon visité sans `processedCount` changé, passage en pause, nouveau paiement hors manifeste, résultat incertain, focus A/B/X/Y et ordre Tab.
- Exécuter les vérifications adaptées au code changé : tests ciblés, typecheck, build, lint, e2e bureau/mobile à 320/390 × 667/844, 1280 × 720, 1536 × 864, 1920 × 1080 avec 125 %, zoom 200 %, FR/EN, trois thèmes et mouvements réduits.
- **Ne pas déclarer exécutés** des tests réellement non lancés ; les anciens 240 Playwright/17 Xbox simulés/75 Node sont les résultats du blueprint de référence, pas ceux de la V3. Un simulateur ne qualifie pas une vraie manette.

## Livrables attendus de Codex

1. Diagnostic initial et liste des écarts réellement observés dans le code courant.
2. Modifications par **petites PR/lots**, sans remplacer des fichiers entiers si un refactoring ciblé suffit.
3. Tableau `G3-xx → fichier(s) modifié(s) → effet conservé → tests passés → risque restant`.
4. Captures avant/après synthétiques, incluant au moins desktop et mobile des quatre modes ainsi que Bon et Passage.
5. Liste explicite des tests exécutés, ignorés et non exécutés ; aucune affirmation de déploiement ou fournisseur réel.

Commence par le **lot A** et son compte rendu. Ne présume pas qu'une proposition de maquette a déjà été implémentée et ne poursuis pas automatiquement les lots destructifs sans avoir comparé la branche réelle au blueprint.
