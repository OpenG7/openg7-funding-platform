# Page À propos et parcours publics

La page `/fonds-des-batisseurs/a-propos`, également disponible sous `/en`,
présente le projet, le rôle du fonds commun et les engagements de transparence.
Elle reste une page de présentation de la feature Funding, standalone et OnPush,
sans chargement financier ni état global supplémentaire.

## Responsabilités et destinations

| Contenu                                           | Destination                             |
| ------------------------------------------------- | --------------------------------------- |
| Utilité du fonds                                  | `/fonds-des-batisseurs#funding-purpose` |
| Contribution                                      | `/fonds-des-batisseurs#support`         |
| Plateformes                                       | `/ecosystem#platforms`                  |
| Montants confirmés, frais et allocations publiées | `/fonds-des-batisseurs/transparence`    |
| Reconnaissance consentie                          | `/batisseurs`                           |
| Commandites approuvées                            | `/commanditaires`                       |
| Aide et participation                             | `/support`                              |
| Conditions                                        | `/politique-utilisation-remboursement`  |

Les liens utilisent `FundingI18nService` pour conserver la langue. Les retours
au fonds emploient la même destination que l’en-tête et le référencement de
l’accueil. Les alias existants `/` et `/en` sont conservés. La navigation
principale expose la page active avec `aria-current="page"`.

Le contenu s’appuie sur les informations déjà présentes dans les pages publiques :
projet indépendant en développement, besoins d’infrastructure, équipe OpenG7,
consentement et revue des commandites. Il ne désigne aucun responsable nominatif
et n’introduit pas de processus de sélection des priorités non documenté.
La transparence financière agrégée est distinguée de la reconnaissance nominative.
Les montants et les états de paiement restent sur leurs pages dédiées.

## Illustration et validation

`yarn images:funding-home` génère également les variantes WebP de l’illustration
À propos, en 960 et 1672 pixels (largeur de la source). Le PNG est conservé pour
le partage social. La page fournit `srcset`, `sizes`, les dimensions et une
priorité de chargement élevée pour cette illustration principale.

```sh
yarn test:ui:funding-about
```

Cette commande compile Angular et son prérendu puis sert les fichiers construits
sur `127.0.0.1:4179`. La suite Playwright couvre les deux langues sur ordinateur
et mobile : liens contextuels, sections réellement atteintes, clavier, langue,
image chargée, absence de débordement et contenu sans JavaScript avec ses balises
canoniques et alternatives. Les API sont interceptées; aucune base de données,
configuration Stripe ou opération de seed/cleanup n’est utilisée.
