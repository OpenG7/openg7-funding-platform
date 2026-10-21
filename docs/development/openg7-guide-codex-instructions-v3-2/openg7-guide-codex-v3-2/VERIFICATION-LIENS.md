# Vérification documentaire — Pack Guide OpenG7 V3.2

**Date : 20 octobre 2026.** Validation du dossier livré, **pas de recette applicative**.

## Résultat

| Élément                                                                | Résultat                                     | Méthode                                                                                  |
| ---------------------------------------------------------------------- | -------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Références Markdown présentes dans `source/README-blueprint-actuel.md` | **44**                                       | Extraction de la liste des URL Markdown                                                  |
| Captures incluses                                                      | **7 / 7**                                    | Liens corrigés vers `../captures/*.png` ; existence des fichiers vérifiée                |
| Liens vers les fichiers du dépôt                                       | **37 / 37 structurés**                       | Chemins GitHub absolus épinglés à `1108d8a9`, sans dépendance au répertoire d'extraction |
| Exemples de chemins GitHub vérifiés via l'accès connecté               | **8 / 8**                                    | Lecture d'une ligne du fichier à ce commit                                               |
| Autres chemins GitHub (29)                                             | **Non vérifiés individuellement à distance** | Le rapport n'affirme pas une résolution HTTP générale                                    |
| Liens relatifs des fichiers Markdown actifs                            | **Aucun chemin local manquant**              | `verification/verifier_dossier.py`                                                       |
| Pièces originales                                                      | **Conservées**                               | `source/archives/` ; README original de référence en `.txt` avec ses liens historiques   |

## Échantillon GitHub vérifié

- `apps/funding-web/src/app/features/funding/components/admin-guidance/admin-guidance.component.html`
- `apps/funding-web/src/app/features/funding/components/admin-preparation/preparation-pilot.component.ts`
- `apps/funding-web/src/app/features/funding/components/admin-automatic/admin-automatic-portfolio.component.html`
- `apps/funding-web/src/app/features/funding/components/admin-automatic/admin-preparation-carousel.component.ts`
- `docs/development/admin-guide-artwork.md`
- `docs/technical/admin-automatic-runs.md`
- `docs/operations/admin-pilotage.md`
- `tests/playwright/admin-controller-journeys.spec.ts`

## Reproduire la vérification locale

Après extraction de l'archive :

```bash
python verification/verifier_dossier.py
```

Ce script confirme les 44 liens du README actif, les sept captures et l'existence des chemins locaux utilisés par les autres documents Markdown. Il **ne** se connecte pas à GitHub et ne prétend pas vérifier les autorisations d'accès ou l'évolution ultérieure des fichiers distants.

## Corrections connexes

Dans `source/blueprint-proposition-v3-corrige.md`, les descriptions « état courant » / « résultat court (courant) » ont été corrigées : le dernier résultat est **une observation datée du passage**, comme son rapport. Le snapshot original reste archivé ; le document courant du checkout Codex reste à auditer.
