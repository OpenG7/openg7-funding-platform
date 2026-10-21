# OpenG7 Funding Platform — Guide administratif · Instructions Codex V3.2

**20 octobre 2026 · Livraison documentaire, aucune modification applicative.**

Ce paquet corrige V3.1 à partir des **cinq remarques de la revue en lecture seule de Codex**. Il privilégie une **PR 1 courte : diagnostic du contrôle sélectionné, CTA existant et « Autres actions », clavier et Xbox dans la même recette**. Le regroupement Bon / Passage / Autre préparation est **reporté dans une PR 2 indépendante**, après vérification des cycles de vie.

## À utiliser en premier

1. Lire `REPONSE-A-CODEX.md`, qui répond point par point aux cinq remarques.
2. Fournir `PROMPT-CODEX-A-COLLER.md` à Codex et le laisser commencer par **l'audit du worktree**.
3. Utiliser `INSTRUCTIONS-CODEX.md` comme contrat d'implémentation, `SPECIFICATION-UX-V3.2.md` pour le rendu et `RECETTE-V3.2.md` pour la recette.
4. Comparer à `source/README-blueprint-actuel.md` (texte d'inventaire du 19 octobre, références réparées) et aux sept captures synthétiques.
5. Ne traiter la future PR 2 qu'après réception et validation de la PR 1 ; **ne jamais entreprendre une refonte complète de la plateforme** pour satisfaire ce paquet.

## Livrables

| Chemin                                       | Usage                                                                                 |
| -------------------------------------------- | ------------------------------------------------------------------------------------- |
| `REPONSE-A-CODEX.md`                         | Acceptation et correction explicite des cinq remarques                                |
| `PROMPT-CODEX-A-COLLER.md`                   | Prompt court et autonome pour la PR 1                                                 |
| `INSTRUCTIONS-CODEX.md`                      | Phases, fichiers propriétaires, invariants et livrables exigés                        |
| `SPECIFICATION-UX-V3.2.md`                   | Décisions précises sur le diagnostic, le CTA, le menu intégré et les vues ultérieures |
| `RECETTE-V3.2.md`                            | Scénarios de PR 1 et de PR 2, avec séparation des effets métier                       |
| `CHANGELOG-V3.2.md`                          | Différences V3.1 → V3.2                                                               |
| `VERIFICATION-LIENS.md`                      | Rapport de vérification des références de l'archive                                   |
| `source/README-blueprint-actuel.md`          | Snapshot fonctionnel historisé ; **44 liens corrigés**                                |
| `source/blueprint-proposition-v3-corrige.md` | Texte V3 avec « dernier résultat » corrigé en **observation datée**                   |
| `source/archives/`                           | Pièces V3 et V3.1 conservées pour traçabilité ; **non normatives** en cas de conflit  |
| `captures/`                                  | Sept captures desktop/mobile synthétiques de la refonte constatée                     |
| `reference/`                                 | Ancien cadrage à simplifier : référence de densité, pas une spécification métier      |

## Référence de code et limites

- **Révision signalée comme commit de refonte par Codex :** `1108d8a9` ; la lecture GitHub de cette référence a été confirmée sur des chemins échantillons. Le code **effectivement présent dans le checkout de Codex** demeure la source d'autorité. Ne pas réinitialiser ni écraser un travail local.
- Le relevé `source/README-blueprint-actuel.md` a été produit le 19 octobre à partir de `30e812a6` et de changements locaux : sa date et sa provenance restent explicites. Sa présence dans cette archive ne le transforme pas en test de production.
- Le Guide reste **non modal** ; la modification du menu utilise **l'état `peek/open` du contrôleur existant**, sans nouveau popover flottant ni changement des règles de commande.
- Paiement confirmé, offre, consentement, revue, préparation, approbation, visibilité Web, envoi, livraison, preuve et remboursement restent **des faits distincts**.
- L'approbation du bon reste **versionnée et confirmée** ; la préparation privée par le conducteur existant est préservée ; aucun lecteur du Guide ne devient une autorité métier.

**Statut : spécification prête à être transmise ; code, déploiements, PR et tests applicatifs non exécutés dans cette préparation.**
