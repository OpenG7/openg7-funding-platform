# Ce que nous construisons ensemble

La page `/fonds-des-batisseurs/realisations` et sa version
`/en/fonds-des-batisseurs/realisations` présentent un aperçu des allocations
publiques du Fonds. Le titre français est « Ce que nous construisons ensemble ».
Cette première itération est implémentée localement. Ses validations ci-dessous
ne qualifient aucune mise en production.

## Source et limites de l'aperçu

La page lit `GET /api/public/fund-transparency`, comme la
[Transparence](funding-transparency.md). Elle réutilise
`latest_public_allocations` du [contrat public](../packages/funding-core/src/public-funding.ts),
sans nouvel endpoint, écriture, contrat ou migration.
La [projection PostgreSQL](../apps/funding-api/src/public-allocations.repository.ts)
retourne au plus huit allocations, de statut `published` ou `active`, ordonnées
par publication récente avec repli sur la création. Les éléments privés,
brouillons ou archivés ne sont pas exposés.

Cet aperçu ne constitue ni un inventaire exhaustif des projets ni un total des
réalisations de l'écosystème. Le mode `stripe_direct` fournit des faits financiers,
pas les informations de projets du registre PostgreSQL. Son absence d'allocations
ne démontre pas l'absence de projets.

Le montant affecté indique l'utilisation prévue documentée pour une allocation;
il ne démontre ni une dépense exécutée ni une réalisation livrée. La page ne
recalcule aucun solde, rendement ou « capital productif ». Les contributions
restent distinctes des allocations; aucun lien causal individuel entre un paiement
et un projet n'est établi.

## Statuts, références et dates

L'avancement déclaré est distinct de la publication de la fiche :

| Champ `progress_status` | Sens affiché       |
| ----------------------- | ------------------ |
| `planned`               | Prévu              |
| `in_progress`           | En cours           |
| `delivered`             | Livraison déclarée |

Une URL de preuve HTTPS publiée est une référence consultable, pas une vérification
indépendante de son contenu ni une certification de la réalisation. Si le lien
est absent ou inadmissible, la projection de sécurité retire ensemble l'URL,
la source et la date de référence; aucun lien n'est inventé.

`published_at` date la publication de l'allocation; `proof_published_at` date celle
de la référence lorsqu'elle est renseignée. Ces dates ne prouvent pas une date
d'exécution, de paiement ou de livraison. Une donnée absente reste absente.

La « Dernière consultation réussie » date la lecture côté navigateur, sans dater
les changements des projets. La page n'utilise pas `last_updated_at`, qui suit
les événements financiers, pour présenter leur fraîcheur.

## États de lecture et navigation

- Chargement initial : annoncer la lecture sans présenter une liste vide comme
  un résultat confirmé.
- Lecture réussie sans allocation : expliquer qu'aucune allocation publique n'est
  disponible dans cet aperçu, sans conclure qu'aucun projet n'existe.
- Première lecture indisponible : afficher l'indisponibilité et permettre de
  réessayer; ne pas la convertir en zéro projet ou zéro montant.
- Échec d'actualisation : conserver les dernières données connues avec un
  avertissement; elles ne sont pas présentées comme fraîchement confirmées.

Les routes et libellés FR/EN, les états annoncés, le clavier et le responsive font
partie de la validation de la page. Ses liens orientent vers la Transparence et
les parcours de contribution existants. La page publique est en lecture seule;
elle ne publie aucune allocation et ne modifie aucun consentement ni paiement.

La [vision économique](vision/economic-refinery.md) conserve séparément la
philosophie fondatrice. La présence de cette page ne transforme pas ses ambitions
en fonctionnalités livrées ou en nouveaux engagements commerciaux.

## Validation locale du 21 novembre 2026

Build Angular production réussi avec 27 routes; `yarn build`, vérification
TypeScript et 280 tests Node passés. Les 11 scénarios de la page passent sur
Chromium, Firefox, WebKit et mobile WebKit, soit 44 exécutions : Axe WCAG 2A/AA
et 2.1 AA, navigation FR/EN, SSR direct, respect des montants fournis, filtrage
des références, états de lecture, échec d'actualisation et délai de 15 secondes
suivi d'une reprise au clavier.

Après correction du lien d'exploration pour conserver la route courante,
96 vérifications passent sur cette même matrice : navigation et liens de la page,
parcours publics existants, langues, confidentialité, styles et reflow.
Les lectures API sont interceptées avec des données synthétiques; ces tests
ne constituent pas une recette API/PostgreSQL ou fournisseur réel.

Format, `yarn docs:check` et `git diff --check` réussis. `yarn lint` passe avec
un avertissement préexistant de directive ESLint inutilisée dans
`scripts/smoke-public.mjs`.
