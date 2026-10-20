# Changelog — V3.1 → V3.2

## Révisé à la suite de Codex

1. **Non-duplication ciblée :** le diagnostic central est condensé ; l'intitulé du contrôle reste légitime dans la liste, le détail et les repères accessibles. Aucun chantier de réimplémentation du CTA ou de l'approbation déjà uniques.
2. **Menu intégré, non flottant :** `Autres actions` reste dans la surface actuelle du pilote (`peek` / `open`) ; aucun popover externe avec nouvelles règles de clic extérieur, trapping ou superposition.
3. **Absent ≠ désactivé :** absence de descripteur/permission pertinente → aucune commande fictive ; descripteur existant temporairement indisponible → raison annoncée si l'interface le présente et si le rôle le permet.
4. **Sous-vues reportées :** PR 2 séparée, avec conservation de la sélection, du focus, des opérations en vol et notification non intrusive des checkpoints à lire.
5. **Correction historique :** dernière observation du passage explicitement datée ; deux libellés incorrects de V3 corrigés dans sa copie de travail, sans falsifier le README historique.
6. **Référence Git :** commit de refonte signalé `1108d8a9` ; audit du worktree requis.
7. **Liens documentaires :** 44 liens du snapshot réparés (7 vers captures de l'archive ; 37 vers GitHub au commit de référence), avec rapport de vérification et pièces originales préservées.
8. **Recette ordonnée :** PR 1 tests souris, clavier et Xbox simulé dans une même livraison ; PR 2 tests du cycle de vie des sous-vues distincts et non anticipés.

## Conservé

- Quatre modes, panneau non modal, carrousel numéroté et bon partagé.
- Trois cibles distinctes (bon consulté, dossier suivant du lot, paiement suivi), sans synchronisation implicite.
- Préparation privée admissible, confirmations métier, rôles API, `requestId`, versions et réconciliation.
- FR-CA/EN, trois thèmes, accessibilité, support de la manette réaffectable, précautions SSR et `data-og7`.
- Les snapshots d'origine et sept captures synthétiques comme référence historique.

## Non effectué

Aucune modification du code Angular/API, aucun commit, aucune PR, aucun essai fournisseur ni manette physique. La recette V3.2 est **une liste de tests à exécuter**, pas un résultat de validation.
