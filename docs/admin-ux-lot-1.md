# Lot 1 — Cadrage des données et socle visuel admin

Réalisé le 15 septembre 2026, selon le [plan de travail](./admin-ux-plan-de-travail.md), les [requis UX](./admin-ux-direction.md) et la [maquette](./images/admin-ui.png).

## Résultat

Le tableau de bord utilise désormais un layout admin réutilisable, une navigation en quatre groupes et un thème bleu nuit/or. Le bandeau donne accès à l’Assistant et au changement de langue. Le menu se replie sur mobile.

La page affiche les données de l’API existante avec des libellés adaptés à leur sens réel. Les cartes, badges, boutons et icônes forment le socle des prochains lots.

La navigation partagée est regroupée sur les autres pages admin également. Leur contenu conserve son layout actuel jusqu’à l’harmonisation du lot 7.

## Matrice des données et écrans

Toutes les lectures administratives nécessitent l’autorisation côté API. Le guard Angular facilite la navigation; il ne remplace pas cette autorisation. Le layout n’effectue aucune lecture financière.

| Bloc                                                      | Source actuelle                                                 | Sens et périmètre                                                                                                 | Actualisation et limites                                                                                                                              |
| --------------------------------------------------------- | --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identité du bandeau                                       | Session admin existante                                         | Acteur administratif technique, affiché « Administration ».                                                       | Connexion et déconnexion existantes; aucun nom de personne ou responsable inventé.                                                                    |
| Navigation                                                | Routes admin existantes                                         | Pilotage, Opérations, Finances, Système. Transparence reste accessible sous Finances.                             | État actif depuis le routeur; aucune requête métier. Les badges d’action arriveront au lot 4.                                                         |
| Montants encaissés                                        | `GET /api/admin/dashboard`, `totals.total_received`             | Brut cumulé enregistré pour les contributions payées, remboursées ou en litige. Avant frais et remboursements.    | Chargement à l’entrée et bouton Actualiser. Montant d’affichage en unités majeures selon le contrat existant, devise fournie par l’API.               |
| Solde estimé                                              | `totals.current_available_estimate`                             | Estimation existante après remboursements et litiges, hors frais Stripe et dépenses.                              | Aucun calcul financier ajouté au navigateur. Ce montant ne porte pas le libellé « net ».                                                              |
| Commandites                                               | `sponsorship_review.total`                                      | Nombre de dossiers payés, remboursés ou en litige. Plusieurs dossiers peuvent appartenir à une même organisation. | Ne représente pas un nombre d’entreprises distinctes.                                                                                                 |
| Commandites à publier                                     | `feed_publication.planned`                                      | Nombre de fiches dont le statut de publication est `planned`, sur le même périmètre de commandites.               | Ne représente ni un nombre de posts par canal, ni des créneaux programmés.                                                                            |
| Revue des commandites                                     | `sponsorship_review.pending/approved/rejected`                  | Répartition des dossiers selon la revue administrative.                                                           | Lecture du snapshot global; lien vers la liste existante. Paiement, revue et publication restent indépendants.                                        |
| Publications des commandites                              | `feed_publication.planned/drafted/published/active`             | Répartition des fiches; `active` comprend les trois statuts affichés.                                             | La page n’additionne pas fiches, lots et créneaux.                                                                                                    |
| Dernières contributions                                   | `recent_contributions`                                          | Au plus huit contributions récentes retournées par l’API; nom public ou entreprise, montant, état et date.        | Lien direct par `contributionId`. Un nom manquant devient « Sans nom »; le courriel privé ne sert plus de nom de remplacement sur ce tableau de bord. |
| Événements Stripe                                         | `stripe_events.failed/processing/last_failed_at`                | État de traitement des événements déjà reçus.                                                                     | N’affirme pas que Stripe est opérationnel. Lien vers Configuration.                                                                                   |
| Date de mise à jour                                       | `last_updated_at`                                               | Horodatage fourni par le serveur pour les données du tableau de bord.                                             | Affiché en `America/Toronto`, selon la langue choisie. Il ne constitue pas un contrôle de santé des fournisseurs.                                     |
| Disponibilité du snapshot                                 | Nouveau champ `data_available`                                  | `false` si PostgreSQL n’est pas configuré; `true` pour un snapshot construit avec un pool DB.                     | Une erreur de requête DB produit toujours un échec HTTP. Une DB absente n’est plus présentée comme un fonds vide par ce tableau de bord.              |
| À traiter                                                 | Résumé déterministe `/api/admin/assistant/summary`, à compléter | File d’interventions avec priorité, faits et action.                                                              | Intégration au cockpit au lot 2, avec comptage global et pagination.                                                                                  |
| Assistant contextuel et dossier en cours                  | Services Assistant et commandites existants                     | Contexte du dossier et prochaine action justifiée.                                                                | Lots 3 et 4. Le bouton du bandeau ouvre dès maintenant la page Assistant existante.                                                                   |
| Net, tendances, activité transverse et santé des systèmes | Projections à compléter                                         | Données confirmées, périodes comparables, événements liés et contrôles horodatés.                                 | Lot 5; aucune valeur de démonstration ni courbe simulée dans la page livrée.                                                                          |
| Recherche globale                                         | Endpoint à créer                                                | Recherche protégée et regroupement des objets liés.                                                               | Lot 6; aucun champ de recherche inactif dans le bandeau.                                                                                              |

### Périodes, devise et fraîcheur

- Les valeurs actuellement affichées sont cumulées depuis le début du fonds, sans filtre temporel.
- La date et l’heure utilisent le fuseau métier `America/Toronto`; les langues disponibles sont `fr-CA` et `en`.
- Les nouvelles tendances du lot 5 devront comparer le dernier mois civil complet au mois précédent, avec les périodes nommées dans l’interface. Les mini-courbes utiliseront des séries réelles; leur cadence sera définie avec la projection.
- Les contrats monétaires existants d’affichage sont conservés. Toute nouvelle agrégation financière sera calculée côté serveur à partir d’unités mineures entières, par devise explicite.
- L’actualisation est manuelle dans ce lot. Aucun polling ne sollicite Stripe ou les autres fournisseurs.

## États et session

| Situation                             | Comportement livré                                                                             |
| ------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Premier chargement                    | Statut annoncé, bouton Actualiser désactivé, aucun montant fictif.                             |
| Chargement réussi avec données        | Indicateurs, répartitions et dernières contributions.                                          |
| DB configurée sans contribution       | Compteurs à zéro et état vide explicite.                                                       |
| DB non configurée                     | Message d’indisponibilité et lien vers Configuration; les cartes de montants sont masquées.    |
| Premier chargement en échec           | Alerte et possibilité de réessayer.                                                            |
| Échec d’une actualisation             | Dernier snapshot conservé avec avertissement de données potentiellement périmées.              |
| Session absente ou expirée localement | Retour à la connexion avant la lecture du tableau de bord.                                     |
| Réponse HTTP 401                      | Données retirées, session locale effacée et retour à la connexion, avec destination de retour. |
| Réponse HTTP 403                      | Données retirées et message d’accès refusé.                                                    |
| Déconnexion                           | Session effacée et navigation vers `/admin/login`.                                             |

Le dashboard repose encore sur une seule réponse API. La disponibilité indépendante de chaque bloc sera introduite avec les projections des lots suivants.

### Évolution additive du contrat

`AdminDashboardResponse.data_available?: boolean` est ajouté aux exports existants de `funding-core`. L’API renseigne ce champ; la propriété reste optionnelle pour préserver la compatibilité des consommateurs et anciennes réponses. En l’absence du champ, le front conserve le comportement de lecture historique.

Les endpoints, les montants et les états métier existants restent compatibles. Aucune migration, aucun backfill et aucun changement de variable d’environnement ne sont nécessaires.

## Composition UI

| Élément                                 | Responsabilité                                                                           | Niveau et emplacement                                                     |
| --------------------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `AdminLayoutComponent`                  | Placement du bandeau, de la navigation et du contenu; accès direct au contenu principal. | Template dans `features/funding/components/admin-layout`.                 |
| `AdminNavComponent`                     | Destinations regroupées, état actif, menu mobile et déconnexion.                         | Organisme admin existant, adapté.                                         |
| `AdminDashboardPageComponent`           | Chargement du snapshot, états, navigation et formatage d’affichage.                      | Page routée existante, template et styles séparés.                        |
| `AdminMetricCardComponent`              | Afficher une valeur fournie avec son libellé et sa portée.                               | Molécule de présentation admin; inputs typés, aucune lecture API.         |
| `AdminBadgeComponent`                   | Afficher un statut lisible, indépendamment de sa couleur.                                | Atome local avec tonalité typée.                                          |
| `AdminIconComponent`                    | Pictogramme vectoriel décoratif, sans nom accessible dupliqué.                           | Atome local avec nom typé.                                                |
| `admin-theme.css`, `admin-controls.css` | Couleurs, surfaces, boutons, liens et focus.                                             | Styles locaux réutilisables; aucun changement global des pages publiques. |

Les nouveaux composants sont standalone et OnPush. Les états locaux utilisent des signals. Les primitives n’ont aucune dépendance à Stripe, PostgreSQL ou au client HTTP.

### Responsive, accessibilité et langues

- Quatre cartes à grande largeur, deux à largeur intermédiaire, une sur petit écran.
- Navigation repliable jusqu’à 860 px dans le nouveau layout, avec `aria-expanded`, fermeture par Échap et restauration du focus.
- Menu en flux normal : il ne constitue pas une modale et ne capture pas le clavier.
- Lien d’évitement vers le contenu principal, liens de contribution natifs, noms accessibles, états annoncés et focus visible.
- Palette contrastée et états accompagnés de texte. Les couleurs principales et des badges ont été contrôlées numériquement contre leur fond.
- Traductions du nouveau tableau de bord, du bandeau et de la navigation; langue conservée entre les pages admin et après rechargement.
- Les routes publiques conservent leur langue canonique selon leur URL.
- Le rendu admin reste en mode client selon la configuration SSR existante. La compilation Angular et le prérendu des 22 routes publiques réussissent; les nouvelles lectures navigateur sont protégées. Aucun changement du mode de rendu admin.

## Validation et limites

Commande reproductible pour le lot :

```bash
yarn test:ui:admin
```

Elle compile Angular, vérifie les types du périmètre UI admin et exécute neuf scénarios Playwright sur l’application construite. Le serveur statique écoute uniquement sur `127.0.0.1:4179`. Les appels API sont interceptés avec des fixtures synthétiques; cette commande ne démarre pas l’API, ne charge pas `.env` et ne prépare pas de DB.

Résultats :

- Compilation Angular et prérendu des 22 routes publiques réussis.
- Compilation TypeScript et 183 tests Node réussis avec `yarn test`.
- Neuf tests navigateur réussis : navigation, clavier, langue, chargement/retry, DB absente/vide, 401/403, connexion/déconnexion et responsive.
- Captures aux largeurs 1672, 1024, 768, 390 et 320 px; anglais vérifié à 320 px. Captures disponibles sous `test-results/admin-layout` après la commande.
- Lint ciblé des fichiers TypeScript touchés réussi.
- Les contrôles globaux lint/format présentaient déjà des erreurs avant les modifications. La vérification TypeScript de tous les tests signale également des fixtures et imports manquants dans des tests non modifiés. Le périmètre UI du lot dispose d’une vérification de types isolée réussie.
- La suite Docker/Stripe complète n’a pas été exécutée pour ce lot. Les tests navigateur de ce livrable prouvent le comportement du front avec des réponses contrôlées; ils ne prouvent pas une intégration réelle avec Stripe, SMTP ou PostgreSQL.

La revue et les actions financières existantes sont préservées. Les prochains travaux portent sur la file « À traiter » du lot 2, puis le contexte du dossier.
