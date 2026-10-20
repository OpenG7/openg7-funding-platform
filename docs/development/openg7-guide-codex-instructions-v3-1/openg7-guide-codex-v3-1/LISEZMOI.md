# OpenG7 Funding Platform — Dossier d'instructions Codex V3.1

**Mise à jour : 20 octobre 2026.** Cette version complète les instructions V3 après revue UX du menu **« Autres actions »** et du bloc **« Pilotage de la préparation »**. Elle vise une simplification de l'expérience, **sans perte de fonctionnalité métier**.

## Démarrage rapide

1. Extraire **tout** le dossier dans un emplacement accessible à Codex (ou lui joindre l'archive entière).
2. Fournir à Codex `PROMPT-CODEX-A-COLLER.md` en premier. Il référence toutes les autres pièces.
3. Exiger l'audit du **worktree local** avant toute édition : le blueprint source repose sur un commit Git et des modifications **non commitées**.
4. Faire traiter **l'unicité du CTA et le menu contextuel** avant les changements de CSS ; puis la densité visuelle et la recette Xbox.
5. Faire produire un bilan de tests **nouveaux et réellement exécutés** ; ne pas réutiliser les anciens résultats comme preuves V3.1.

## Pièces du dossier

| Fichier                                     | Rôle                                                                                    |
| ------------------------------------------- | --------------------------------------------------------------------------------------- |
| `PROMPT-CODEX-A-COLLER.md`                  | Mission courte à copier dans Codex                                                      |
| `INSTRUCTIONS-CODEX.md`                     | Consignes détaillées, phases, responsables et invariants                                |
| `BLUEPRINT-UX-V3.1-RESPONSABILITES.md`      | Addendum de design : modèle de responsabilité, menu « Autres actions », CTA, wireframes |
| `RECETTE-V3.1.md`                           | 30 scénarios ciblés, risques et critères de réception                                   |
| `CHANGELOG-V3.1.md`                         | Changements vis-à-vis de V3                                                             |
| `source/README-blueprint-actuel.md`         | Inventaire de l'implémentation **avant V3.1**, fourni par l'utilisatrice                |
| `source/blueprint-proposition-v3.md`        | Spécification V3 conservée intacte                                                      |
| `source/prompt-codex-v3-original.md`        | Anciennes instructions V3 conservées pour comparaison                                   |
| `captures/01-...png` à `captures/07-...png` | Captures de tests synthétiques de la refonte précédente                                 |
| `reference/extrait-avant-a-simplifier.png`  | Cadrage du design imbriqué à alléger, non source de règles métier                       |

## Décision UX importante

**Le Guide oriente et lit ; ses conducteurs existants peuvent explicitement vérifier et préparer des brouillons privés ; les écrans métier restent propriétaires des validations et effets externes.**

Dans « Autres actions » :

- garder les opérations secondaires réellement disponibles, même si elles nécessitent d'ouvrir Campagnes, l'historique ou une assistance spécialisée ;
- garder **une seule** action principale hors menu et **une seule** approbation dans le bon partagé ;
- ne jamais démarrer un job en ouvrant le menu ;
- conserver rôles, versions, idempotence, sécurité API, état de focus et mapping Xbox réaffectable.

Visuellement, remplacer la succession de boîtes jaune/bleu et le bouton jaune pleine largeur par **un seul diagnostic lisible, une action bien proportionnée et un menu discret**. Conserver la palette OpenG7, le thème lumineux, le dragon et les illustrations décoratives lorsque l'espace le permet.

## Portée / limites

- **Pas de modification du dépôt GitHub, du code Angular ni de la base de données par ce paquet.**
- Aucun test de l'application n'a été exécuté pour fabriquer ces documents.
- Les sept captures du dossier représentent des scénarios **synthétiques** ; elles ne prouvent pas le fonctionnement réel d'un fournisseur ni d'une manette Xbox physique.
- En cas de conflit entre une maquette et les règles métier, **le code et les contrats serveur vérifiés prévalent**.

## Ordre de livraison souhaité

**PR 1** : responsabilités/commandes contextuelles, unicité CTA/approbation, états et tests.\
**PR 2** : composition sobre, responsive, FR/EN, accessibilité.\
**PR 3** : navigation Bon/Passage/Autre et retours, **uniquement si manquants** dans le code actif.\
**PR 4** : vérification ciblée contrôleur Xbox/desktop/mobile et non-régression transverse.

**Priorité immédiate :** un audit puis un premier lot ciblé ; ne pas reconstruire le Guide intégralement.
