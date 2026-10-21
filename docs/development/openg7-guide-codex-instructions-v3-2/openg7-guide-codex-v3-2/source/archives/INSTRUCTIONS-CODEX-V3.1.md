# Instructions d'implémentation — Codex / OpenG7 Guide administratif V3.1

> **Objet :** mise à jour des instructions V3 après décision de simplifier les responsabilités et le menu **« Autres actions »**. Ce document est destiné à Codex sur le dépôt local `openg7-funding-platform` ; il ne démontre pas une implémentation ou une exécution de tests.

## Références et ordre de priorité

1. **Code actif et contrats API de l'arbre de travail local.** Le README fourni décrit la révision `30e812a6e9f981e67a92022e040c84b7fdbd4bf2` **plus des modifications locales non commitées**. Ne pas reconstruire aveuglément depuis le commit distant.
2. `source/README-blueprint-actuel.md` et sept captures de référence `captures/` : état réel documenté de la refonte précédente.
3. `BLUEPRINT-UX-V3.1-RESPONSABILITES.md` : nouvelles décisions de conception autour du menu et de l'unicité des responsabilités.
4. `source/blueprint-proposition-v3.md` : améliorations précédentes G3-01 à G3-17, conservées sauf conflit explicite avec V3.1.
5. `RECETTE-V3.1.md` : tests de non-régression et critères d'acceptation.
6. `reference/extrait-avant-a-simplifier.png` : **contre-exemple esthétique**, cadrage ancien sur de grands blocs jaune/bleu ; ne pas l'utiliser comme spécification de données ni comme preuve de comportement.

En cas de conflit entre une préférence visuelle et les préconditions métier/contrats existants, **préserver le métier** et documenter le compromis. Ne pas changer la politique API sans demande explicite.

## Objectif de cette passe

**Simplifier le bloc « Pilotage de la préparation » et « Autres actions », puis valider leurs interactions avec le Guide** : ne conserver qu'un diagnostic clairement présenté, une action principale, des actions secondaires contextualisées et un accès explicite à leurs propriétaires métier. Réduire la densité visuelle et les doublons, sans perdre les parcours, boutons réellement nécessaires, historiques, permissions, confirmations, versions, audits ou capacités de préparation privée.

**Déjà livré — ne pas réimplémenter :** quatre modes nommés, rail desktop / grille responsive, contrôle sélectionné et CTA direct, priorité des contrôles non satisfaits, groupe « Vérifiés » replié, carrousel numéroté, réessai de modules différés, restauration du focus et gestion contextuelle du contrôleur.

## Phase 0 — audit du code réel (obligatoire)

Avant de modifier :

1. Afficher `git status --short`, `git branch --show-current` et `git rev-parse HEAD`. Repérer les changements non commitées et ne pas les réinitialiser, écraser ou formater massivement.
2. Identifier les composants et services :
   - `apps/funding-web/src/app/features/funding/components/admin-guidance/` et `components/admin-layout/` ;
   - `components/admin-automatic/admin-automatic.component.*`, `admin-automatic-portfolio*`, `admin-preparation-carousel*` ;
   - `components/admin-preparation/admin-preparation-receipt*`, `preparation-pilot*`, `preparation-issue-list*`, `preparation-context-actions.ts` ;
   - `components/admin-context-controller/context-controller-action.component.ts`, `components/admin-controller/`, `components/admin-pilotage/controller.service.ts` ;
   - `services/admin-confirmation.service.ts` ; catalogues FR/EN ; contrats `packages/funding-core/` ; règles API concernées (lecture seulement si aucun changement API requis).
3. Inventorier pour chaque contrôle (`publications_promises`, etc., selon IDs _réels_) : **CTA principal, actions secondaires disponibles, actions conditionnelles, effets L/N/P/M/E, rôle, version, écran propriétaire, raccourcis actifs**. Ne pas inventer de descripteurs ni fixer des noms de contrôles si le code en emploie d'autres.
4. Distinguer dans un mini-audit : **existant**, **amélioration réellement nécessaire**, **hypothèse à vérifier**. Repérer l'origine des libellés « Pourquoi ? », « Assistance », « Autres actions », « Voir les prestations dans Campagnes », « Historique », « Voir la source » et « Relancer ».
5. Vérifier la chaîne concrète de gestion des actions : sélection du contrôle → projection → CTA/context action → dispatch → propriétaire → éventuelle confirmation → réception/réconciliation. Vérifier que le changement d'interface ne peut pas changer la cible/version.
6. Présenter les risques et proposer le premier lot minimal avant de refondre plusieurs propriétaires.

## Lot 1 — contrat de responsabilité des actions (P1, avant le CSS)

- **Une seule action principale** hors menu, issue du **descripteur actuel** et conforme au statut du contrôle. Si aucune action admissible, montrer une absence d'action appropriée, pas un faux CTA.
- Garder « Approuver la préparation » **uniquement** dans le bon partagé et sa confirmation courante ; ne pas l'ajouter au menu, ni déclencher cette approbation depuis une simple sélection de contrôle.
- « Autres actions » : **seulement les actions secondaires** propres à la sélection/version/rôle. Préserver les actions existantes de lecture, Campagnes, historique, source, proposition assistée, relance d'assistance si effectivement offertes.
- Classer éventuellement les items en sous-groupes **Consulter** et **Assistance spécialisée** ; ce groupement ne doit pas engendrer de nouveaux services ou de nouvelles routes. Éviter de créer 6 cartes grises lorsque 2 actions seulement sont pertinentes.
- Si une action est indisponible, utiliser le **motif existant** (ex. source absente) ; ne pas inventer une capacité IA ou un traitement non raccordé. Contrôler l'accessibilité d'un élément désactivé et de sa raison.
- **Ne pas déplacer un POST de relance/assistance** vers un autre service. On peut changer son point d'entrée visuel si la même opération/version/requestId/propriétaire et tous les liens contextuels subsistent.
- À l'ouverture : seule l'affichage/focus change, **aucun job ni mutation** ; à la fermeture : aucune annulation implicite d'une requête déjà envoyée.
- À la sélection d'un autre contrôle, d'un autre bon, au changement de version/mode ou à la révocation d'accès : fermer/réconcilier le menu pour interdire tout dispatch sur ancien sujet. Conserver l'état nécessaire au retour de navigation existant.
- En cas d'historique vide, afficher un état vide explicite ou masquer l'entrée selon le contrat de consultation ; **ne pas annoncer une décision/approbation fictive**.

**Critère de sortie Lot 1 :** matrice avant/après des actions prouvant qu'aucune capacité admissible n'a disparu, qu'une seule approbation existe et qu'aucun menu ouvert ne provoque de POST.

## Lot 2 — composition UX « Pilotage de la préparation » (P1/P2)

- Pour un contrôle sélectionné : montrer **une seule fois** son nom, une seule formulation courte du manque, sa conséquence, son état exact, le lien « Pourquoi ? », une éventuelle entrée Assistance et le CTA principal.
- Ne plus afficher simultanément plusieurs boîtes et bandes portant **la même phrase** : « Publications promises » dans titre/panneau jaune/bouton ne doit pas devenir une triple explication.
- Conserver la liste de contrôles, les états requis et le groupe « Vérifiés » repliable dans le composant existant. Pas de compteur « 7 » hardcodé ; ignorer `not_required` comme déjà prévu.
- Ne pas faire de « Autres actions » un panneau de formulaire permanent : préférer une liste contextuelle courte, ouverte sur demande et fermée par défaut. Un bandeau de danger n'est pas nécessaire pour un champ simplement manquant.
- Faire du blanc et du bleu marine la structure visuelle, avec accent doré mesuré. Éviter l'énorme bouton jaune pleine largeur sur desktop ; CTA dimensionné au texte, accessible, stable. Sur mobile, utiliser une largeur fluide pour garder une cible de 44 px minimum.
- Le bloc doit rester compréhensible dans un rendu 1920×1080 à 125 %, 1280×720, 1536×864 et les petits formats du dossier de référence ; ne pas supposer qu'une maquette 4K représente le viewport CSS.
- Ne pas supprimer les précisions sur l'accord historique : l'offre acceptée à l'origine doit être qualifiée par preuve ; le barème actuel ne peut pas la remplacer rétroactivement.
- Si un contrôle devient « Vérifié » après relecture, ajuster l'intitulé et l'accès au CTA selon le descripteur réellement disponible, sans réécrire son contrat métier.

## Lot 3 — parcours du Guide, Bon/Passage/Autre (P1/P2 : seulement si encore manquant)

Les améliorations V3 restent pertinentes, **mais confirmer d'abord leur état dans la branche active** :

- Trois vues de présentation locales : « Bon consulté », « Passage et bilan », « Autre préparation ». **Pas de nouvelle route, pas de moteur parallèle** ; éviter démontage des requêtes en cours, pertes de requestId ou interruption non voulue.
- Le lot peut réellement démarrer/reprendre/pauser/revérifier et appeler `advance` **sur action explicite** ; conserver ces comportements. Une sélection de vue, carrousel ou menu ne remplace pas le checkpoint « Vérifier et préparer ce dossier ».
- Montrer clairement 3 cibles indépendantes : bon consulté, prochain dossier du lot, paiement suivi. Ne jamais synchroniser les ID par hypothèse.
- Distinguer : X/Y bon consulté ≠ X/Y dossiers contrôlés ≠ X/Y contrôles satisfaits ; bilan avec catégories chevauchantes et observations datées, non sommables.
- L'appel « Examiner le dossier / Voir le suivi » depuis le rapport **peut mettre le lot en pause et démarrer une préparation ciblée** : annoncer son effet avant activation ; ne pas l'étiqueter comme simple lecture.
- `Revérifier` réexamine le même manifeste figé ; les paiements nouveaux demandent un nouveau passage explicite.
- Conserver le rapport, les preuves, l'historique, la pagination et les corrections dans leurs écrans propriétaires. Ne pas introduire de vue « rapport » amputée de sa traçabilité.

## Lot 4 — interaction Xbox / clavier / accessibilité (P1)

- Ne pas coder un raccourci « A = compléter l'accord » : **A sur le contrôle sélectionné** en `peek` peut ouvrir Autres actions, **A sur le bouton focalisé** exécute sa commande, selon le profil effectivement sélectionné.
- Les badges contextuels sont dérivés des **descripteurs du contrôleur en cours** ; conserver X/Y de source/relance/historique quand admissibles, B en `open` vers `peek`, Échap, LB/RB, Home/End, retour au neutre et la priorité des dialogues.
- Éviter deux représentations visibles « Retour » qui font le même geste. Les gestuelles distinctes doivent être annoncées selon focus, avec priorité visible des confirmations.
- Lire l'ordre DOM/focus du bon partagé et du panneau ouvert ; corriger les sauts vérifiés sur clavier/lecteur d'écran sans casser Campagnes/Publication qui réutilisent le bon.
- Panneau **non modal**, jamais de confinement du focus. En mode mobile 320/390 px et hauteur 667/844, garantir l'accès aux modes et commandes, y compris avec dock de manette, clavier virtuel et zoom 200 %. En mode réduit, la page sous-jacente reste utilisable.
- Préserver FR-CA/EN, SSR, `data-og7`, thèmes clair/nuit/graphite, contraste et réduction des mouvements.

## Invariants fonctionnels à conserver

1. **Paiement confirmé ≠ offre acceptée ≠ consentement/droits média ≠ revue commanditaire ≠ modération ≠ préparation approuvée ≠ visibilité Web ≠ autorisation de livraison ≠ publication envoyée ≠ preuve qualifiée ≠ courriel remis.**
2. L'approbation du bon demeure **unique**, avec `canApprove`, rôle, ID/version attendus, `requestId`, confirmation humaine, audit et contrôle API ; aucune duplication dans Autres actions.
3. L'Assistant non raccordé ne devient pas un LLM réel par changement de présentation ; afficher uniquement les fonctions présentes, mock/disabled si applicable.
4. Pas de POST dû à l'ouverture/fermeture d'un menu, au changement de vue ou à la navigation de carrousel. Le job `advance` et les relances restent des gestes explicites.
5. Résultat incertain → rapprochement du reçu → action volontaire ; jamais de rejeu aveugle, ni de requête en double après pause/réduction/navigation.
6. Les droits API gardent autorité ; harmoniser la présentation du rôle `reader` sans créer d'autorisations ou d'interdictions locales concurrentes.
7. Aucune perte des références, preuves, audits, versions historiques, droits d'utilisation, retours au dossier ou contextes de contrat.
8. Une proposition assistée, un brouillon privé ou une étape de guide visitée n'approuvent rien et ne produisent aucune publication.

## Livrables exigés de Codex

1. **Rapport d'audit** : état de la branche/worktree ; tableau des actions secondaires réellement disponibles et leurs propriétaires ; liste des améliorations déjà livrées.
2. **Plan minimal** avec chemins précis, classement par lots et risques ; ne pas refactoriser tous les modules par principe.
3. **Modifications ciblées** des composants existants, avec diff clair et texte FR-CA/EN externalisé.
4. **Tableau traçable** : IDs `G31-xx` et, si concernés, `G3-xx` → fichiers touchés → ancienne/nouvelle présentation → effets conservés → tests.
5. **Recette** selon `RECETTE-V3.1.md` ; capture avant/après du contrôle sélectionné et du menu, en desktop/mobile, incluant un contrôle disponible/indisponible et un profil Xbox simulé.
6. Énumérer les tests **réellement exécutés** (commande, résultat) et ceux non exécutés ; ne pas déclarer le site déployé ni une manette physique testée sans preuve.

**Ordre recommandé :** Phase 0 → Lot 1 (responsabilité / actions) → Lot 2 (UI calme) → Lot 4 (clavier/Xbox) → Lot 3 (navigation plus large si nécessaire). Traiter chaque lot par petite PR cohérente, sans écraser le travail antérieur. Ne pas commencer par reconstruire le composant entier.
