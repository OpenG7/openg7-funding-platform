# Prompt pour Codex — OpenG7 Guide administratif V3.2 (PR 1 uniquement)

Tu travailles dans le dépôt local `OpenG7/openg7-funding-platform`. **Objectif de cette passe : auditer puis simplifier uniquement la présentation du diagnostic du contrôle sélectionné, son CTA déjà existant et le menu intégré « Autres actions », avec recette souris, clavier et Xbox simulé dans la même PR.** Ne démarre **pas** la refonte Bon / Passage / Autre préparation dans cette PR.

Le dossier d'instructions V3.2 contient, à lire dans cet ordre :

1. `REPONSE-A-CODEX.md` — acceptation de tes cinq remarques ;
2. `INSTRUCTIONS-CODEX.md` — audit et périmètre exact de PR 1 ;
3. `SPECIFICATION-UX-V3.2.md` — règles UX du diagnostic et du menu ;
4. `RECETTE-V3.2.md` — tests `PR1-*`, séparés des futurs `PR2-*` ;
5. `source/README-blueprint-actuel.md` — inventaire du 19 octobre, **44 liens réparés**, et sept captures `captures/` ;
6. `source/blueprint-proposition-v3-corrige.md` — proposition précédente corrigée pour **l'observation datée du passage** ; pièces archivées dans `source/archives/` seulement pour comparaison.

**Référence Git :** la refonte est signalée par ta revue comme commitée en `1108d8a9`. Commence par `git status --short`, `git branch --show-current`, `git rev-parse HEAD` et vérifie si le worktree actif inclut effectivement ce commit. Ne réinitialise ni écrase aucun changement local. Le README source a été capturé antérieurement autour de `30e812a6` avec changements locaux : sa prose historique n'atteste pas le nouvel état de production.

**Cinq décisions obligatoires :**

1. **Préserver l'existant :** CTA et approbation déjà uniques. « Non répété » vise **le diagnostic central**, pas le nom du contrôle, qui doit rester identifiable dans la liste et le détail.
2. **Menu intégré au contrôleur existant (`peek/open`) :** liste compacte, pas de popover flottant, pas de nouvelle fermeture au clic extérieur ni de nouvelle gestion de `focus-trap`. **Action absente ≠ action temporairement désactivée** ; une raison connue et accessible doit expliquer cette dernière, sans créer de fausse action.
3. **Sous-vues réservées à une PR 2 :** maintenir hors de cette PR le travail sur Bon/Passage/Autre. Prévoir dans les spécifications futures la restauration bon/contrôle/focus/`requestId` et la visibilité des checkpoints survenant hors vue, sans bascule ni POST automatique.
4. **Observation datée :** « Dernier résultat » et rapport reflètent des **observations datées du passage**, pas une lecture en temps réel du dossier. La copie V3 a été corrigée en ce sens.
5. **Documentation réparée :** liens de référence épinglés à `1108d8a9` et captures relatives locales ; ne pas recopier les anciens chemins brisés ni attribuer au README d'origine un autre état historique.

**Audit obligatoire avant modifications :** inventorie descripteurs/actions de chaque contrôle (CTA, secondaires actives/désactivées/absentes, rôle/capacité, version, cible, propriétaire, effet lecture/préparation/mutation). Présente les éléments déjà livrés, les écarts **constatés**, et les améliorations uniquement stylistiques. Préserve `AdminPreparationReceiptComponent` partagé, les routes propriétaires, les décisions humaines, les états de préparation privée, les permissions API, versions, `requestId`, confirmations, audit et réconciliation. Un menu ouvert ne déclenche pas de job.

**Implémentation minimale :** diagnostic plus lisible, moins de cadres imbriqués, CTA proportionné, secondaires discrètes dans le `peek/open` actuel. Ne crée pas de nouvelle UI de gestion d'accord ni d'IA. Une relance d'assistance déjà offerte conserve **son effet métier et ses préconditions** ; elle se déclenche uniquement volontairement. La légende Xbox découle du profil réellement actif.

**Tests dans la même PR :** souris, Tab/Shift+Tab, Échap, A/B/X/Y, changement de focus, contrôle/bon/version, retour au neutre, confirmation prioritaire, cas `reader`, résultats incertains, FR/EN, thèmes, zoom, mobile et usage du reçu depuis Campagnes/Publication. Utilise `RECETTE-V3.2.md`, tests existants et captures synthétiques ; documente tests exécutés et non exécutés.

**Livraison attendue :** PR 1 limitée, audit, diff expliqué, preuve des tests, captures avant/après, risques et propositions éventuelles pour PR 2 — **sans implémenter PR 2**. En cas de P0 reproduit (mauvaise cible, action implicite, approbation double ou rejeu aveugle), traite/signalise ce point avant le travail cosmétique.
