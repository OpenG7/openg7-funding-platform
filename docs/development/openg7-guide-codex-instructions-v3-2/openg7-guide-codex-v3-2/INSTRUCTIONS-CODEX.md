# Instructions de travail pour Codex — Guide OpenG7 V3.2

**Mission : faire une PR 1 petite et vérifiable, puis s'arrêter.** Les sous-vues Bon / Passage / Autre seront traitées séparément après accord. Le Guide reste un panneau non modal et ne devient pas un deuxième moteur métier.

## A. Sources et priorité

1. **Worktree réellement ouvert** : branch, `HEAD`, changements locaux, contrats API et contrôleurs réels. Ne jamais effacer les changements non commités.
2. **Refonte signalée comme commitée : `1108d8a9`.** Vérifier si le `HEAD` contient cette révision ou ses changements avant toute comparaison ; ne pas supposer que la branche de travail l'utilise.
3. `source/README-blueprint-actuel.md` : snapshot du 19 octobre, liens corrigés, texte métier préservé ; vérifier les écarts plutôt que réimplémenter des éléments déjà livrés.
4. `REPONSE-A-CODEX.md` et `SPECIFICATION-UX-V3.2.md` : décisions V3.2 **prioritaires** sur les propositions anciennes.
5. `source/blueprint-proposition-v3-corrige.md` : contexte V3, avec deux corrections terminologiques sur le résultat de passage ; seulement les éléments compatibles avec V3.2.
6. `RECETTE-V3.2.md` : preuve attendue ; `source/archives/` contient des pièces historiques **non normatives** si conflit.
7. Captures : **données synthétiques**, utiles pour comparer la densité, non pour déduire des droits ou états API.

## B. Phase 0 — audit obligatoire sans édition initiale

Exécuter et rapporter :

```bash
git status --short
git branch --show-current
git rev-parse HEAD
```

Puis examiner les fichiers du worktree (chemins à confirmer, non nouvelle architecture) :

- `apps/funding-web/src/app/features/funding/components/admin-guidance/` et `components/admin-layout/` ;
- `components/admin-automatic/admin-automatic.component.*`, `admin-automatic-portfolio*`, `admin-preparation-carousel*` ;
- `components/admin-preparation/admin-preparation-receipt*`, `preparation-pilot*`, `preparation-issue-list*`, `preparation-context-actions.ts` ;
- `components/admin-context-controller/context-controller-action.component.ts`, `components/admin-controller/`, `components/admin-pilotage/controller.service.ts` ;
- `services/admin-confirmation.service.ts`, catalogues FR/EN, contrats `packages/funding-core/` et API de préparation nécessaires à la compréhension (lecture uniquement, sauf défaillance P0 explicitement avérée).

Produire un **tableau de six colonnes** pour chaque contrôle/état étudié : contrôle + version, CTA réellement projeté, autres actions (actives/désactivées/absentes), rôle/capacité, effet de l'action (lecture/navigation/préparation/mutation/effet externe), propriétaire technique. Indiquer les différences `reader/operator/owner` sans déduire les droits des boutons visibles. Confirmer que l'action principale et l'approbation sont **déjà uniques** avant de toucher aux fichiers.

Vérifier la chaîne de bout en bout : sélection → projection → descripteur → rendu (`peek/open`) → focus/contrôleur → dispatch → propriétaire → éventuelle confirmation → version/`requestId` → reçu/réconciliation.

À la fin de l'audit, livrer trois constats séparés : **existant**, **problème reproduit**, **amélioration ergonomique proposée**. Ne pas transformer une préférence stylistique en bogue prouvé.

## C. PR 1 — contrat minimal

### C1. Diagnostic, sans dédoublonner le titre utile

- Garder l'intitulé métier du contrôle dans **la liste de sélection** et dans **le détail sélectionné**.
- Réduire la répétition du **motif explicatif central** (« source de l'accord absente », etc.) dans plusieurs blocs de même niveau. Afficher le statut exact et la conséquence sans les inventer.
- Maintenir le CTA **déjà existant** hors de « Autres actions ». Ne pas réécrire sa projection, son identifiant de cible, sa version ou son propriétaire sans nécessité démontrée.
- L'approbation versionnée du bon reste dans `AdminPreparationReceiptComponent`, **seule entrée d'approbation**. Pas de deuxième accès métier sous un autre libellé.
- Si le contrôle devient satisfait et reste sélectionné après une relecture, ne pas le qualifier abusivement « à compléter » : s'appuyer sur la projection réelle.

### C2. « Autres actions » : liste compacte **intégrée**

- **Réutiliser** l'état/markup `peek/open`, les descripteurs de `preparation-context-actions`, et la navigation existante. **Pas de popover flottant** et aucune nouvelle logique de clic extérieur, de `focus-trap` ou de modalité.
- **Action absente** : ne pas la créer sous forme de faux bouton grisé. **Action temporairement indisponible** : si elle est montrée, conserver son statut inactif et fournir le **motif réel** dans le même contexte accessible.
- Conserver les chemins secondaires admissibles vers Campagnes, l'historique, les sources, la revue assistée et la relance, selon **contrôle, rôle et version** ; ces exemples ne constituent pas une liste statique obligatoire.
- Ouvrir/fermer ne doit faire que modifier la présentation et le focus : **aucun POST de job, aucune approbation ni navigation implicite**. Une relance reste explicitement lancée dans l'organisme propriétaire.
- Sur un autre contrôle, bon, mode, changement de révision ou retrait de session, invalider ou recalculer les actions selon les protections existantes ; aucune commande d'une ancienne cible ne doit rester activable.
- Préserver les commandes de retour et la restitution du focus au déclencheur, sans ajouter de double bouton « Retour » pour la même fermeture.

### C3. Design sobre, ciblé

- Éviter panneau bleu + alerte jaune + CTA jaune pleine largeur superposés autour d'un seul problème.
- Bouton principal compact à droite ou en fin de diagnostic sur desktop ; largeur pleine acceptée sur viewport étroit. Hauteur de cible au moins 44 px ; or réservé à la priorité, pas à tous les cadres.
- Ne pas restructurer le `AdminPreparationReceiptComponent` partagé sans vérifier l'affichage dans Campagnes et Publication.
- Préserver FR/EN, thèmes clair/nuit/graphite, raccourcis contextuels réaffectables, `data-og7`, SSR et préférences de mouvement réduit.

### C4. Même PR, recette **clavier ET Xbox simulé**

Exécuter les scénarios `PR1-*` de `RECETTE-V3.2.md` : A sur contrôle non choisi/choisi/CTA focalisé, B/Esc/Retour, X/Y selon profil, focus, Tab, maintien, confirmations prioritaires, version et `reader`. Couvrir données synthétiques (et temps réseau retardé pour cas incertains), desktop/mobile et au moins le reçu partagé depuis un autre hôte.

**Ne pas qualifier** une manette physique si seule la simulation est exécutée. Fournir les commandes exactes de tests et les captures avant/après.

**Livrer PR 1 seule** : fichiers modifiés, comportement conservé, différences visuelles, résultats de tests et risques ouverts. Si un P0 survient, interrompre les changements d'apparence jusqu'à résolution ou escalade du problème.

## D. PR 2 — proposer séparément, ne pas entreprendre dans PR 1

Après accord explicite, implémenter si utile les trois sous-vues **Bon consulté / Passage et bilan / Autre préparation** dans l'organisme de composition **existant**. Ne pas créer de nouvelle route, machine du lot ou second reçu.

Avant tout code PR 2, spécifier :

1. Comment le **bon courant + contrôle sélectionné + focus/scroll** sont restaurés au retour ; comment l'état `open` des actions est réévalué selon version.
2. Comment les **brouillons, `requestId`, jobs, états réseau, reprises et commandes en vol** restent intacts à travers les vues ; conserver le montage seul ne suffit pas.
3. Comment un **checkpoint du lot arrivant hors vue** est annoncé et rejoint volontairement, sans bascule forcée ni validation automatique.
4. Comment demeurent indépendantes les cibles `carousel.position` (bon B), `run.nextContributionId` (dossier C) et `guidance.snapshot().payment` (paiement A).
5. Comment dernière observation et rapport demeurent **datés**, distincts d'une éventuelle lecture actuelle du dossier.
6. Comment reprise, revérification du même manifeste et nouveau passage avec nouveaux paiements demeurent des gestes distincts.

Faire signer le critère de réception PR 2 avant implémentation. Utiliser `PR2-*` dans `RECETTE-V3.2.md`.

## E. Garanties P0 et livraison

Bloquer la livraison **uniquement si reproduit** : mutation sur mauvaise cible, POST métier induit par lecture/onglet, approbation dupliquée, résultat incertain rejoué sans réconciliation. Les confirmations conservent rôle, ID/version, `requestId`, idempotence et audit ; la réponse API demeure autoritaire.

En sortie de PR 1, Codex doit donner :

- état initial du worktree et commit réellement utilisé ;
- tableau d'audit CTA / commandes et écarts réellement constatés ;
- fichiers changés, justification de chaque changement et absence de duplication de propriétaires ;
- tests réellement exécutés et leurs résultats ; tests non exécutés nommés ;
- captures avant/après sur grand écran, mobile et focus ;
- preuve de navigation souris, clavier et Xbox simulé ;
- éventuelles limites de l'approbation, de la modération et des intégrations externes.

**Pas de migration de données, pas de nouveau fournisseur IA, pas de changement de barème historique et pas de modification de la politique d'accès pour une demande de présentation.**
