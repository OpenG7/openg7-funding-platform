# Consignes Funding Web

Portée : `apps/funding-web/**`; spécialisation métier du standard OpenG7.

Complète le [socle du dépôt](../../AGENTS.md). Lire les références métier de sa
table de lecture lorsque le parcours touché le demande, y compris pour une UI.

## Responsabilité et composition

Angular 21 standalone, OnPush, TypeScript strict, Tailwind 4 et styles existants.
Le Web orchestre routes, chargement, permissions de présentation, contributions,
suivi, transparence et administration; les décisions financières restent à l'API.

Avant de créer un composant, rechercher un équivalent, préciser sa responsabilité,
sa portée (neutre, Funding public ou admin), son niveau et ses inputs/outputs typés.
Atomic Design décrit la responsabilité; il n'impose pas une arborescence globale :

| Niveau    | Responsabilité et placement                                            |
| --------- | ---------------------------------------------------------------------- |
| Atome     | Primitive neutre, sans métier; UI locale ou `packages/funding-ui`      |
| Molécule  | Assemblage ciblé, état de présentation minimal; `components/`          |
| Organisme | Surface métier et orchestration de présentation; feature Funding       |
| Template  | Squelette responsive, sans chargement financier                        |
| Page      | Entrée routée, route/chargement/permissions; `features/funding/pages/` |

Dépendances : pages → orchestration → composants métier → UI neutre → packages.
Une primitive ne dépend ni du routeur, ni de HTTP, Stripe, PostgreSQL, session admin
ou store global. Contribution, commandite, publication, dépense, facture,
remboursement, transparence et audit restent dans le domaine Funding.
Extraire du partagé seulement pour une réutilisation réelle et une API neutre.

## État et rendu

- Utiliser `signal`, `computed`, `effect` pour sélection, filtres, formulaires,
  panneaux, chargement et animation locaux. Réserver NgRx aux données durables
  réellement partagées : total confirmé, campagne, allocations, synchronisation.
- Recharger ou invalider les données serveur après mutation. Ne pas afficher
  paiement, remboursement ou publication comme réussis avant confirmation serveur.
  Le retour Checkout peut remercier, annoncer la confirmation en cours et rafraîchir
  le statut; il ne crée ni transaction payée, facture, publication ni total confirmé.
- Couvrir chargement, vide, erreur, désactivé, non autorisé, données partielles et
  succès non confirmé lorsqu'applicables. Les mocks locaux doivent être identifiables
  et ne pas créer d'enregistrements assimilables à des paiements réels.
- SSR : aucun accès à `window`, `document`, stockage navigateur, viewport, audio,
  canvas ou bibliothèque navigateur au chargement du module sans protection.
  Utiliser une vérification de plateforme ou un import dynamique; éviter les
  divergences d'hydratation dues au temps, au hasard ou aux valeurs navigateur.
- Préserver le chargement différé admin, les statuts HTTP 404 et les parcours FR/EN.

## Accessibilité et contrats UI

- Sélecteurs `openg7-` en kebab-case. Nouveaux hooks E2E : `data-og7` et `data-og7-id`.
  Ne pas tester via une classe CSS/Tailwind; mettre à jour tests et documentation
  lors du renommage d'un hook, sans migration générale des hooks existants.
- Clavier complet, focus visible/restauré après fermeture, noms accessibles,
  erreurs associées aux champs, annonces dynamiques, ordre de lecture et contraste.
- Traductions selon les conventions du projet, `fr-CA` par défaut; aucune nouvelle
  chaîne de production codée en dur lorsqu'une clé est appropriée.
- Vérifier responsive mobile/desktop, SSR et tests adaptés avant de terminer.
  Le guard `canMatch` ne dispense jamais l'API de vérifier les droits.
- Remboursement, suppression de logo, publication, refus, masquage, retry massif,
  backfill, correction de destinataire et export privé exigent une confirmation
  explicite dans l'UI ainsi qu'une validation serveur.

## Pilotage administratif

Lire le [runbook de pilotage](../../docs/operations/admin-pilotage.md) pour cette
surface. Après modification des entrées, vérifier maintien, retour au neutre,
combinaisons, focus et priorité des panneaux. Une recette Gamepad simulée ne
qualifie pas une manette USB/Bluetooth réelle. Chaque commande conserve version,
confirmation, contrôle API et reçu audité; aucun reçu incertain n'est rejoué.

## Validation

Appliquer la [matrice commune](../../docs/development/validation.md) : le build
Angular est distinct de `yarn build`. Ajouter les tests d'états et d'interaction
pertinents; distinguer fixtures UI, API réelle et fournisseur externe.
