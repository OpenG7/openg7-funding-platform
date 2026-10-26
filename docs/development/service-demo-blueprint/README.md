# Blueprint de la démo des prestations

Version 1.0 · 25 octobre 2026 · référence applicative `a4370ba3`.

Ce dossier décrit la démo **Contenu → Consentement → Publication** pour la
reprendre et la faire évoluer avec ChatGPT. Il distingue les comportements
locaux constatés, les opérations illustratives et les évolutions à concevoir.

- [Blueprint complet](blueprint-demo-prestations.md) : produit, écrans, parcours,
  données, règles, style, recette et limites.
- [Prompt de reprise pour ChatGPT](prompt-reprise-chatgpt.md) : texte à copier
  dans une nouvelle conversation après avoir joint le blueprint.
- [Inventaire des vues](inventaire-ecrans.csv) : catalogue réutilisable dans un
  tableur ou comme liste de contrôle.
- [Schéma des parcours](schema-parcours.svg) et [manifeste des captures](captures/manifest.json) :
  navigation et provenance des illustrations réelles.

Les exports HTML autonome, PDF et ZIP sont générés dans
`artifacts/service-demo-blueprint-20261025/`. Le ZIP rassemble les documents,
les captures, leur manifeste et les exports. Le blueprint est le document à
joindre en premier; le prompt indique comment utiliser les autres pièces.
Les sources et captures de ce dossier sont versionnées. Les exports sont des
livrables dérivés locaux.

La référence de code est le
[commit a4370ba3](https://github.com/OpenG7/openg7-funding-platform/tree/a4370ba3133a42e4f37a9c3c615943b698149144),
proposé dans la [PR #383](https://github.com/OpenG7/openg7-funding-platform/pull/383).
Le document ne présume ni fusion de cette PR, ni déploiement, ni disponibilité
d'un service réel derrière les écrans de démonstration.
