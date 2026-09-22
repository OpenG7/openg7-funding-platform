# Consignes des packages

Portée : `packages/**`; spécialisation métier du standard OpenG7.

Complète le [socle du dépôt](../AGENTS.md). Lire également ses références métier
selon le sujet : une règle financière s'applique ici autant que dans l'API.

| Package          | Responsabilité                                                                                      |
| ---------------- | --------------------------------------------------------------------------------------------------- |
| `funding-core`   | Fonctions pures, configuration, calculs déterministes, politiques, validation et transitions métier |
| `funding-models` | Types immuables, unions d'états, interfaces de contrats et valeurs stables                          |
| `funding-ui`     | Tokens, primitives neutres et contrats visuels réellement partagés                                  |
| `funding-i18n`   | Clés, métadonnées de locales et conventions communes                                                |

- Aucun import de fichiers privés sous `apps/**`, cycle de dépendances ou accès
  direct à `.env`. Les modèles n'ont ni effet de bord ni accès réseau/environnement.
- `funding-core` ne dépend pas d'Angular, du serveur HTTP, de PostgreSQL ou du SDK
  Stripe concret. L'API et le Web consomment les contrats publics des packages.
- Ne pas extraire du code pour une réutilisation seulement hypothétique. Les
  primitives UI ne dépendent ni du routeur/HTTP, de Stripe/DB, d'une session admin
  ou d'un store global. Aucun métier ou contenu privé dans `funding-i18n`.
- Lire les [règles Web](../apps/funding-web/AGENTS.md) si un composant Angular est
  réellement ajouté; conserver le vocabulaire Funding dans sa feature.
- Changement de contrat : mettre à jour tous les consommateurs, les tests et la
  documentation, avec compatibilité/transitions explicites lorsque nécessaires.
- Tester les fonctions déterministes et configurations modifiées selon la
  [matrice commune](../docs/development/validation.md).
